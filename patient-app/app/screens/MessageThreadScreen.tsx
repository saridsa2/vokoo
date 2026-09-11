import { useEffect, useRef, useState, type FC } from "react"
// eslint-disable-next-line no-restricted-imports
import {
  Animated,
  Keyboard,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
} from "react-native"
import { useNavigation } from "@react-navigation/native"
import type { NativeStackNavigationProp } from "@react-navigation/native-stack"

import { Glyph } from "@/components/Glyph"
import { PillButton } from "@/components/PillButton"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import type { AppStackParamList } from "@/navigators/navigationTypes"
import {
  OPEN_REQUESTS,
  PASSIVE,
  PROVIDER,
  SPIROMETRY,
  TACROLIMUS,
  THREAD,
  UNIT_PHONE,
  type Message,
} from "@/services/mock/careData"
import { HeadroomRibbon } from "@/components/HeadroomRibbon"
import { MedicineLevel } from "@/components/MedicineLevel"
import { WearableTrends } from "@/components/WearableTrends"
import type { Card } from "@/services/intelligence/chat"

/* Every measurement a card can name, by the key the model passes. */
const SERIES_BY_KEY = Object.fromEntries(
  [SPIROMETRY, TACROLIMUS, ...PASSIVE].map((s) => [s.key, s]),
)
import { visible } from "@/services/intelligence"
import {
  fixedAnswer,
  inventedNumbers,
  withoutInventedNumbers,
} from "@/services/intelligence/safety"
import {
  appendMessage,
  byDay,
  loadTranscript,
  type StoredMessage,
} from "@/services/intelligence/memory"
import { useModel } from "@/services/intelligence/provider"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/**
 * Talking to Sarv, and to a person when Sarv hands over.
 *
 * **Rebuilt when it became a tab.** It was written as a sheet — a header with a
 * close button, and a composer held down by `marginTop: "auto"` inside a
 * ScrollView, which pins nothing. As a sheet that was survivable. As the centre
 * tab it meant there was **no way to type at all**: the composer sat below the
 * fold of a scroll nobody would think to scroll. The layout is now three fixed
 * parts — header, scrolling thread, pinned composer — which is what a
 * conversation always needed.
 *
 * **One thread and three senders.** Sarv answers immediately and around the
 * clock; a coordinator takes over when Sarv decides it should not answer. The
 * patient never picks a recipient — picking means picking wrongly and waiting on
 * somebody who is off that week — and the voice path already works this way.
 *
 * **The handover is drawn, not implied.** A rule across the thread saying who
 * has it now. Letting a coordinator's reply appear in Sarv's colours would be
 * the one deception this product cannot afford: a patient must always know
 * whether the sentence in front of them came from a person.
 */
export function MessageThreadScreen() {
  const { themed, theme } = useAppTheme()
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>()

  const [draft, setDraft] = useState("")
  /**
   * The transcript, from the store rather than from component state.
   *
   * It was seeded from the mock on every mount, so each launch began the
   * conversation again — and what a patient asked last Tuesday is part of their
   * record of their own care.
   */
  const [messages, setMessages] = useState<StoredMessage[]>(() => loadTranscript(THREAD))
  const [pending, setPending] = useState<{ name: string; pages?: number }[]>([])
  const [thinking, setThinking] = useState(false)

  /**
   * How many days back are on screen. One — today — until somebody pulls.
   */
  const [daysShown, setDaysShown] = useState(1)
  const thread = useRef<ScrollView>(null)

  const allDays = byDay(messages)
  const shown = allDays.slice(Math.max(0, allDays.length - daysShown))

  /* The keyboard pushes the composer up over the thread, so the last message
     has to be brought back into view when it opens. */
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", () =>
      thread.current?.scrollToEnd({ animated: true }),
    )
    return () => sub.remove()
  }, [])

  /* The app's one model session, from the provider above the navigator. It was
     `useLocalModel()` here, which built a *second* session — so chat sat at
     `isReady: false` and told the patient it could not answer while setup had
     already finished loading the weights. */
  const model = useModel()

  /**
   * Whether a question can be asked at all.
   *
   * `thinking` is in here too: a second question sent while the first is
   * generating queues behind it on a single-session model, and the patient gets
   * two answers at once with no way to tell which was to which.
   */
  const canAsk = model.state === "ready" && !thinking

  /**
   * Whether a person has come onto the thread.
   *
   * **Not who the patient is talking to.** Sarv sits between the patient and
   * the unit and always has: the patient asks Sarv, and Sarv brings in a person
   * when it should. Swapping the header to "Sister Lakshmi" said the opposite —
   * that the thread had become a different conversation with a different party
   * — when what actually happened is that Sarv fetched somebody, which is a
   * fact about this thread rather than a change of address.
   *
   * So this only decides what the state line says and what to expect back.
   */
  const holder = [...messages].reverse().find((m) => m.from !== "you")?.from ?? "agent"
  const withHuman = holder === "human"

  /* Offered by whatever was said last, and only while it is still last. */
  const last = messages[messages.length - 1]
  const offered = last?.from !== "you" ? last?.replies : undefined

  function attach() {
    setPending((a) => [...a, { name: `Photo ${a.length + 1}`, pages: 1 }])
  }

  /**
   * Sarv answers from the model on this phone.
   *
   * The patient's words, their record and the reply all stay here — which is
   * the whole argument for the local model, and the reason chat was the first
   * thing to wire it to. Nothing about this turn touches a network.
   *
   * The record is rebuilt per turn rather than carried in the session, so a
   * reading sent five minutes ago is visible to the next answer.
   */
  async function send(text?: string) {
    const body = (text ?? draft).trim()
    if (!body && pending.length === 0) return

    const mine: Message = {
      id: `msg-${messages.length + 1}`,
      from: "you",
      author: "You",
      at: "Just now",
      body: body || (pending.length === 1 ? "Here is the report." : "Here are the reports."),
      attachment: pending[0],
    }
    setMessages((all) => appendMessage(all, mine))
    setDraft("")
    setPending([])

    if (!body) return

    /**
     * No model, no answer — and it says so rather than inventing one.
     *
     * A phone that cannot run it, or a patient who has not finished setting it
     * up, gets a plain sentence pointing at the people who can actually help. A
     * fabricated reply from something called Sarv, in a transplant app, is the
     * worst thing this screen could do.
     */
    /**
     * Three different "no", and they are not the same sentence.
     *
     * Still loading is a *wait*; not set up is a *do this*; cannot run it at
     * all is a *go to your team*. Saying "I cannot answer on this phone yet" to
     * all three — which is what it did — tells somebody whose model is thirty
     * seconds from ready that the feature does not work.
     */
    if (model.state !== "ready") {
      const body =
        model.state === "loading"
          ? "I am still getting ready — this only happens once. Try me again in a minute."
          : model.state === "checking"
            ? "One moment, I am just waking up."
            : model.state === "off"
              ? "I am not set up on this phone yet. You can finish that in Settings."
              : `I cannot answer on this phone. Your care team can — the unit's number is on the Care team screen.`
      setMessages((all) =>
        appendMessage(all, {
          id: `msg-${all.length + 1}`,
          from: "agent",
          author: "Sarv",
          at: "Just now",
          body,
        }),
      )
      return
    }

    /**
     * The app answers the dangerous questions, not the model.
     *
     * "I have a temperature" has one correct response — the unit's number, now
     * — and generating that sentence adds nothing while risking everything. The
     * model is never shown the question.
     */
    const fixed = fixedAnswer(body)
    if (fixed) {
      setMessages((all) =>
        appendMessage(all, {
          id: `msg-${all.length + 1}`,
          from: "agent",
          author: "Sarv",
          at: "Just now",
          body: fixed.text,
          card: fixed.card,
        }),
      )
      return
    }

    setThinking(true)
    try {
      const { text, card } = await model.ask(body)

      /**
       * Refused if it states a figure the record does not hold.
       *
       * A plain string check, not a judgement, so there is nothing for a model
       * to talk its way past. It exists because the prompt already forbids
       * inventing numbers and the model invented one anyway — twice, differently
       * each time, which is what proved it was generating rather than reading.
       */
      const checked = withoutInventedNumbers(visible(text))
      if (__DEV__ && !checked) {
        console.warn("[sarv] refused, invented:", inventedNumbers(visible(text)))
      }
      const reply = checked
      setMessages((all) =>
        appendMessage(all, {
          id: `msg-${all.length + 1}`,
          from: "agent",
          author: "Sarv",
          at: "Just now",
          /* When the reply is refused there is nothing true to put in its
             place, so it says so and points at the people who can answer —
             rather than a softened version of a sentence that was wrong. */
          body:
            reply ||
            "I do not have that in your record, so I cannot answer it. Your care team can — their number is on the Care team screen.",
          card: reply ? card : undefined,
        }),
      )
    } catch {
      /* Named, not swallowed. A silent failure leaves somebody waiting for a
         reply that is never coming. */
      setMessages((all) =>
        appendMessage(all, {
          id: `msg-${all.length + 1}`,
          from: "agent",
          author: "Sarv",
          at: "Just now",
          body: __DEV__
            ? `Failed: ${model.error ?? "unknown"}`
            : "Something went wrong answering that. Your care team can help — the unit's number is on the Care team screen.",
        }),
      )
    } finally {
      setThinking(false)
    }
  }

  return (
    <Screen preset="fixed" contentContainerStyle={themed($container)} safeAreaEdges={["top"]}>
      {/* Sarv, not the hospital. This is the tab for talking to the agent, and
          heading it with the provider's name told the patient they were writing
          to a building. The unit's name belongs on what the unit asks for. */}
      <View style={themed($head)}>
        <View style={$headBody}>
          <Text preset="bold" text="Sarv" style={themed($title)} numberOfLines={1} />
          {/* One line, and short enough to be one. It carried the unit's name
              and a clause about when it answers, which wrapped to three lines
              and made the header taller than two messages. */}
          <Text
            preset="formHelper"
            /* Who else is reading, when somebody is. Sarv answering instantly
               and a person answering in clinic hours are both true at once
               after a handover, and the person is the newer fact. */
            text={withHuman ? "Sister Lakshmi is on this" : "Answers straight away"}
            style={themed($subtitle)}
            numberOfLines={1}
          />
        </View>
        {/* Voice, one tap from the conversation. Somebody too breathless to type
            should not have to find a different screen to say so. */}
        <Pressable
          onPress={() => navigation.navigate("Call")}
          accessibilityRole="button"
          accessibilityLabel="Call Sarv"
          style={({ pressed }) => [themed($callButton), pressed && { opacity: 0.85 }]}
        >
          <Glyph name="phone" size={17} color={theme.colors.palette.neutral100} />
        </Pressable>
      </View>

      <ScrollView
        ref={thread}
        style={$thread}
        contentContainerStyle={themed($threadBody)}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        /**
         * Older days arrive by pulling down, the way more of anything arrives.
         *
         * The thread opened on a year of conversation, so the first thing a
         * patient met was the top of a wall they had to scroll through to reach
         * this morning. It starts on today and each pull uncovers one more day
         * back — which is also what keeps the list short enough to stay quick
         * on a phone that is running a model at the same time.
         */
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => setDaysShown((d) => Math.min(d + 1, allDays.length))}
            tintColor={theme.colors.textDim}
            title={daysShown < allDays.length ? "Pull for earlier" : "That is the beginning"}
            titleColor={theme.colors.textDim}
          />
        }
        /* Anchored to the bottom: a new message, and the keyboard opening,
           both have to bring the latest line into view. A thread that stays
           where it was reads as one that did not send. */
        onContentSizeChange={() => thread.current?.scrollToEnd({ animated: true })}
      >
        {/**
         * Grouped by day, with a rule and a date between them.
         *
         * The thread ran as one unbroken column, so a message from Tuesday sat
         * directly under one from this morning with nothing to say so. On a
         * year-long programme that is the difference between reading your own
         * history and reading a wall.
         *
         * Today's group carries no label. A conversation whose first heading is
         * the word "Today" is labelling the obvious; the separators exist to
         * mark where you have scrolled *back* to.
         */}
        {shown.map((group, gi) => (
          <View key={group.label + gi}>
            {group.label !== "Today" || gi < shown.length - 1 ? (
              <View style={themed($daySplit)}>
                <View style={themed($dayRule)} />
                <Text preset="formHelper" text={group.label} style={themed($dayLabel)} />
                <View style={themed($dayRule)} />
              </View>
            ) : null}
            {group.messages.map((message, i) => (
              <View key={message.id}>
                {/* A timestamp only where the run breaks. One under every line
                    put the clock in competition with the words. */}
                <Bubble
                  message={message}
                  showTime={group.messages[i + 1]?.at !== message.at}
                  turnChange={i > 0 && group.messages[i - 1].from !== message.from}
                />
                {message.handover ? <Handover /> : null}
              </View>
            ))}
          </View>
        ))}
      </ScrollView>

      <View style={themed($composer)}>
        {/**
         * One row that scrolls, not a block that wraps.
         *
         * Four replies wrapped to two rows and took as much height as the
         * composer and the thread's last message together — on the screen whose
         * whole job is the conversation. A single row keeps them to one line
         * however many there are, and horizontal scrolling is the right gesture
         * for a strip of suggestions you can also ignore.
         */}
        {/* Sarv's turn, while it is taking one. In the thread and on Sarv's
            side, because that is where the answer is about to appear — a status
            line floating above the composer belongs to the app, not to the
            conversation. */}
        {thinking ? <Typing /> : null}

        {/**
         * Thinking, said once and quietly.
         *
         * A small model on a phone takes seconds, not milliseconds, and a
         * thread that sits silent after you press send reads as a message that
         * did not go. It replaces the suggested replies rather than sitting
         * beside them — offering answers to a question that has not been
         * answered yet is the app talking over itself.
         */}
        {offered ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={themed($replies)}
          >
            {offered.map((reply) => (
              <Pressable
                key={reply}
                onPress={() => send(reply)}
                accessibilityRole="button"
                style={({ pressed }) => [themed($reply), pressed && { opacity: 0.85 }]}
              >
                <Text preset="formHelper" text={reply} style={themed($replyText)} />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {pending.map((file, i) => (
          <View key={file.name} style={themed($pending)}>
            <Glyph name="reports" size={16} color={theme.colors.textDim} />
            <Text preset="formHelper" text={file.name} style={themed($pendingName)} />
            <Pressable
              onPress={() => setPending((a) => a.filter((_, j) => j !== i))}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${file.name}`}
              hitSlop={10}
            >
              <Glyph name="close" size={14} color={theme.colors.textDim} />
            </Pressable>
          </View>
        ))}

        {/**
         * One field, with both controls inside it.
         *
         * They were three siblings in a row — a square, a bordered text field,
         * another square — so the composer read as a toolbar with a box in the
         * middle rather than as somewhere to write. Putting them inside the
         * field's own border is what every messaging app does, and it is not
         * decoration: it makes the whole strip one target-rich object instead of
         * three, and it gives the text the full width between them.
         */}
        <View style={themed($composerRow)}>
          <Pressable
            onPress={attach}
            accessibilityRole="button"
            accessibilityLabel="Attach a report"
            hitSlop={8}
            style={({ pressed }) => [themed($inlineButton), pressed && { opacity: 0.6 }]}
          >
            <Glyph name="attach" size={19} color={theme.colors.textDim} />
          </Pressable>

          {/**
           * Closed until the model can answer.
           *
           * It accepted questions while the weights were still loading and
           * replied "I am still getting ready" — which is an app taking a
           * patient's words and giving them nothing. Worse on this screen than
           * most: somebody typing "I have a temperature" is reporting a symptom,
           * and a box that accepts it implies somebody received it.
           *
           * Shut rather than silent, and the placeholder says which of the two
           * reasons it is.
           */}
          <TextInput
            value={draft}
            onChangeText={setDraft}
            editable={canAsk}
            /* Always Sarv. The patient writes to Sarv whoever else is reading —
               that is what "in between" means. */
            placeholder={
              canAsk
                ? "Ask Sarv"
                : model.state === "loading" || model.state === "checking"
                  ? "Sarv is getting ready…"
                  : "Sarv is not available on this phone"
            }
            placeholderTextColor={theme.colors.textDim}
            multiline
            style={[themed($input), !canAsk && $shut]}
          />

          <Pressable
            onPress={() => send()}
            disabled={!canAsk || (!draft.trim() && pending.length === 0)}
            accessibilityRole="button"
            accessibilityLabel="Send"
            hitSlop={8}
            style={({ pressed }) => [
              themed($sendButton),
              (draft.trim() || pending.length > 0) && themed($sendButtonActive),
              pressed && { opacity: 0.85 },
            ]}
          >
            <Glyph
              name="send"
              size={17}
              color={
                draft.trim() || pending.length
                  ? theme.colors.palette.neutral100
                  : theme.colors.palette.neutral500
              }
            />
          </Pressable>
        </View>
      </View>
    </Screen>
  )
}

/** The rule that says the conversation changed hands. */
function Handover() {
  const { themed, theme } = useAppTheme()
  return (
    <View style={themed($handover)}>
      <View style={themed($rule)} />
      <View style={themed($handoverLabel)}>
        <Glyph name="careTeam" size={14} color={theme.colors.asked} />
        <Text preset="formHelper" text="Passed to the unit" style={themed($handoverText)} />
      </View>
      <View style={themed($rule)} />
    </View>
  )
}

/**
 * A message.
 *
 * Three senders, three treatments: the patient's sit right in the asked-blue,
 * Sarv's sit left on the card ground, and a person's take the ink left border —
 * the same rule the node cards follow, that an element belonging to something
 * takes its colour. Side and weight, never colour alone, so the thread is
 * readable to someone who cannot separate two hues.
 */
/**
 * Sarv taking its turn.
 *
 * Three dots that fade in sequence, in a bubble on Sarv's side of the thread —
 * the shape every messaging app uses, and for the reason they all use it: it
 * says *an answer is coming here*, in the place it is coming.
 *
 * It replaced a grey line above the composer reading "Sarv is reading your
 * record…". That was the app narrating itself from outside the conversation,
 * and on a small model taking eight seconds it left the thread looking dead.
 */
const Typing: FC = function Typing() {
  const { themed, theme } = useAppTheme()
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0.25))).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.stagger(
        160,
        dots.map((d) =>
          Animated.sequence([
            Animated.timing(d, { toValue: 1, duration: 320, useNativeDriver: true }),
            Animated.timing(d, { toValue: 0.25, duration: 320, useNativeDriver: true }),
          ]),
        ),
      ),
    )
    loop.start()
    return () => loop.stop()
  }, [dots])

  return (
    <View style={[themed($bubbleRow), $turnChange]}>
      <View style={[themed($bubble), themed($theirs), $typing]}>
        {dots.map((d, i) => (
          <Animated.View
            key={i}
            style={[$dot, { opacity: d, backgroundColor: theme.colors.textDim }]}
          />
        ))}
      </View>
    </View>
  )
}

const AnswerCard: FC<{ card: Card }> = function AnswerCard({ card }) {
  const { themed, theme } = useAppTheme()

  if (card.kind === "call_unit") {
    return (
      <View style={themed($card)}>
        {/* Wrapped, for the third time in this app. `PillButton`'s block style
            is `flexGrow: 1, flexBasis: 0`; dropped straight into a container
            with height to spare it fills it, which is why the number came out
            as a black bar four hundred points tall. */}
        <View>
          <PillButton
            text={UNIT_PHONE}
            onPress={() => Linking.openURL(`tel:${UNIT_PHONE.replace(/\s/g, "")}`)}
            icon={<Glyph name="phone" size={18} color={theme.colors.palette.neutral100} />}
          />
        </View>
        <Text preset="formHelper" text="Answered 24 hours." style={themed($cardNote)} />
      </View>
    )
  }

  if (card.kind === "reading") {
    const series = SERIES_BY_KEY[card.key]
    if (!series) return null
    return (
      <View style={themed($card)}>
        {series.band ? (
          <MedicineLevel series={series} />
        ) : series.baseline !== undefined && series.action ? (
          <HeadroomRibbon series={series} height={70} />
        ) : (
          <WearableTrends series={[series]} />
        )}
      </View>
    )
  }

  return (
    <View style={themed($card)}>
      {OPEN_REQUESTS.map((r) => (
        <View key={r.id} style={themed($todoRow)}>
          <Text preset="default" text={r.what} style={themed($body)} />
          <Text preset="formHelper" text={`${r.daysLeft} day(s)`} style={themed($cardNote)} />
        </View>
      ))}
    </View>
  )
}

function Bubble({
  message,
  showTime,
  turnChange,
}: {
  message: StoredMessage
  showTime: boolean
  /** True when the speaker changed from the message above. */
  turnChange?: boolean
}) {
  const { themed, theme } = useAppTheme()
  const mine = message.from === "you"
  const human = message.from === "human"

  return (
    <View style={[themed($bubbleRow), turnChange && $turnChange, mine && $mineRow]}>
      <View
        style={[
          themed($bubble),
          mine ? themed($mine) : themed($theirs),
          human && [$humanEdge, { borderLeftColor: theme.colors.asked }],
        ]}
      >
        {!mine && (
          <View style={themed($authorRow)}>
            <Glyph name={human ? "careTeam" : "message"} size={13} color={theme.colors.textDim} />
            <Text preset="formHelper" text={message.author} style={themed($author)} />
          </View>
        )}
        <Text preset="default" text={message.body} style={themed($body)} />

        {/**
         * What Sarv asked the app to show.
         *
         * Rendered from the record by the app, not written by the model — so a
         * wrong tool call costs the patient the wrong card, never a wrong
         * number. `call_unit` draws the number as a button; pressing it is the
         * patient's decision, which is the whole reason the model is not
         * allowed to place the call itself.
         */}
        {message.card ? <AnswerCard card={message.card} /> : null}

        {message.attachment ? (
          <View style={themed($attachment)}>
            <Glyph name="reports" size={18} color={theme.colors.textDim} />
            <View style={$attachmentBody}>
              <Text preset="formHelper" text={message.attachment.name} style={themed($body)} />
              {message.attachment.pages ? (
                <Text
                  preset="formHelper"
                  text={`${message.attachment.pages} page${message.attachment.pages === 1 ? "" : "s"} · sent`}
                  style={themed($at)}
                />
              ) : null}
            </View>
          </View>
        ) : null}
      </View>
      {showTime ? <Text preset="formHelper" text={message.at} style={themed($at)} /> : null}
    </View>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.sm,
  gap: spacing.sm,
})

const $head: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.sm,
  paddingBottom: spacing.xs,
  borderBottomWidth: 1,
  borderBottomColor: colors.separator,
})

const $headBody: ViewStyle = { flex: 1, gap: 2 }

/**
 * A real step between the two lines.
 *
 * The name was `subheading` and the line under it `formHelper`, which on this
 * device land close enough together that the header read as two equal lines of
 * the same thing. 17 over 12 is the difference between a name and a note about
 * it.
 */
const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.text,
  fontSize: 17,
  lineHeight: 21,
})

const $subtitle: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 12,
  lineHeight: 15,
})

/* Square, like every other control in this app. A circle is a shape; a button
   is not one, however small it is — the same rule that squared the canvas and
   the cards. */
const $callButton: ThemedStyle<ViewStyle> = ({ colors }) => ({
  width: 38,
  height: 38,
  borderRadius: 0,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: colors.tint,
})

const $thread: ViewStyle = { flex: 1 }

const $threadBody: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  gap: spacing.md,
  paddingVertical: spacing.sm,
})

/**
 * Space between messages, and more between speakers than inside one turn.
 *
 * They sat two points apart, so a reply from Sarv and the question that
 * prompted it read as one block of text. A conversation is legible because the
 * gaps say where one person stopped and the next began — which means the gap
 * between two people has to be bigger than the gap between two lines from the
 * same one.
 */
const $bubbleRow: ThemedStyle<ViewStyle> = () => ({
  alignItems: "flex-start",
  gap: 2,
  maxWidth: "92%",
  marginTop: 6,
})

/* The bigger gap, applied where the speaker changes. */
const $turnChange: ViewStyle = { marginTop: 18 }

const $mineRow: ViewStyle = { alignSelf: "flex-end", alignItems: "flex-end" }

const $shut: ViewStyle = { opacity: 0.5 }

const $typing: ViewStyle = { flexDirection: "row", alignItems: "center", gap: 5 }

/* Inside the bubble, under the words: the card belongs to the answer rather
   than sitting beside it as a separate thing the patient has to connect. */
const $card: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  marginTop: spacing.sm,
  paddingTop: spacing.sm,
  borderTopWidth: 1,
  borderTopColor: colors.separator,
  gap: spacing.xs,
})

const $cardNote: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $todoRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: spacing.sm,
})

const $dot: ViewStyle = { width: 6, height: 6, borderRadius: 6 }

const $bubble: ThemedStyle<ViewStyle> = ({ spacing }) => ({ padding: spacing.sm, gap: 4 })

const $theirs: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.palette.neutral200,
  borderWidth: 1,
  borderColor: colors.separator,
})

const $mine: ThemedStyle<ViewStyle> = ({ colors }) => ({ backgroundColor: colors.askedBackground })

const $humanEdge: ViewStyle = { borderLeftWidth: 3 }

const $authorRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xxs,
})

const $author: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $body: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text })

/* Small and dim. A timestamp is a footnote, not a line of the conversation. */
const $at: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim, fontSize: 11 })

const $attachment: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  marginTop: spacing.xxs,
  padding: spacing.xs,
  backgroundColor: colors.background,
  borderWidth: 1,
  borderColor: colors.separator,
})

const $attachmentBody: ViewStyle = { flex: 1 }

const $handover: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  marginTop: spacing.md,
})

const $rule: ThemedStyle<ViewStyle> = ({ colors }) => ({
  flex: 1,
  height: 1,
  backgroundColor: colors.separator,
})

const $handoverLabel: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xxs,
})

const $handoverText: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.asked })

const $composer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  gap: spacing.xs,
  paddingBottom: spacing.sm,
})

const $daySplit: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.sm,
  paddingVertical: spacing.sm,
})

const $dayRule: ThemedStyle<ViewStyle> = ({ colors }) => ({
  flex: 1,
  height: 1,
  backgroundColor: colors.separator,
})

const $dayLabel: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $thinking: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingHorizontal: spacing.lg,
  paddingBottom: spacing.xs,
})

const $thinkingText: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.textDim })

const $replies: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  gap: spacing.xs,
  paddingBottom: spacing.xs,
})

/* Pills. They were square outlined boxes at body size, which read as four
   buttons competing with the composer under them rather than as suggestions you
   may ignore. */
const $reply: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  paddingHorizontal: spacing.sm,
  paddingVertical: 6,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: colors.asked,
  backgroundColor: colors.askedBackground,
})

const $replyText: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.asked })

const $pending: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  padding: spacing.xs,
  backgroundColor: colors.palette.neutral300,
  borderWidth: 1,
  borderColor: colors.separator,
})

const $pendingName: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.text, flex: 1 })

const $composerRow: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  /* Bottom, not centre: the field grows upward as the message runs on, and the
     two buttons should stay level with the last line rather than drifting to
     the middle of a four-line draft. */
  alignItems: "flex-end",
  gap: spacing.xs,
  borderWidth: 1,
  borderColor: colors.separator,
  backgroundColor: colors.palette.neutral100,
  paddingLeft: spacing.xs,
  paddingRight: spacing.xxs,
  paddingVertical: spacing.xxs,
})

const $inlineButton: ThemedStyle<ViewStyle> = () => ({
  width: 34,
  height: 34,
  alignItems: "center",
  justifyContent: "center",
})

/* A circle, because it is the one control in the strip that does something
   final. The attach icon beside it is bare for the same reason inverted: it
   opens a picker, and a filled button would claim equal weight. */
const $sendButton: ThemedStyle<ViewStyle> = ({ colors }) => ({
  width: 34,
  height: 34,
  borderRadius: 34,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: colors.palette.neutral300,
})

const $sendButtonActive: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.tint,
})

const $input: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  flex: 1,
  color: colors.text,
  fontSize: 15,
  lineHeight: 20,
  paddingVertical: spacing.xs,
  /* A hard ceiling. `multiline` will otherwise grow until the thread above it
     has nowhere left to be. */
  maxHeight: 110,
})
