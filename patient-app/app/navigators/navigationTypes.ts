import { ComponentProps } from "react"
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs"
import {
  CompositeScreenProps,
  NavigationContainer,
  NavigatorScreenParams,
} from "@react-navigation/native"
import { NativeStackScreenProps } from "@react-navigation/native-stack"

/**
 * Four tabs, and the ceiling is four.
 *
 * Each one answers a question a patient actually arrives with: what do you want
 * from me, how am I doing, what have I sent you, and how do I reach a person.
 * A fifth would mean two of them overlap.
 */
export type MainTabParamList = {
  Today: undefined
  Progress: undefined
  /** The agent, in the middle of the bar. See SarvTabButton. */
  Sarv: undefined
  Reports: undefined
  CareTeam: undefined
}

/**
 * The stack.
 *
 * Signing in and registering sit outside the tabs because there is nothing to
 * navigate to yet; everything pushed *over* the tabs is a single thing being
 * looked at — one request, one programme, one conversation.
 */
export type AppStackParamList = {
  SignIn: undefined
  Register: undefined
  Main: NavigatorScreenParams<MainTabParamList>
  /** One outreach request, opened to answer it. */
  RequestDetail: { requestId: string }
  /** The programme this patient is on — the cohort, from their side. */
  Cohort: undefined
  MessageThread: undefined
  /** A live call with the agent, in the app. */
  Call: undefined
}

export type AppStackScreenProps<T extends keyof AppStackParamList> = NativeStackScreenProps<
  AppStackParamList,
  T
>

export type MainTabScreenProps<T extends keyof MainTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, T>,
  AppStackScreenProps<keyof AppStackParamList>
>

export interface NavigationProps extends Partial<
  ComponentProps<typeof NavigationContainer<AppStackParamList>>
> {}
