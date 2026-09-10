import { View, ViewStyle } from "react-native"
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"

import { CareTeamScreen } from "@/screens/CareTeamScreen"
import { MessageThreadScreen } from "@/screens/MessageThreadScreen"
import { ProgressScreen } from "@/screens/ProgressScreen"
import { ReportsScreen } from "@/screens/ReportsScreen"
import { TodayScreen } from "@/screens/TodayScreen"

import type { MainTabParamList } from "./navigationTypes"
import { SarvTabBar } from "./SarvTabBar"

/**
 * The five tabs.
 *
 * Each answers a question a patient arrives with — *what do you want from me,
 * how am I doing, what have I sent you, how do I reach a person* — and a fifth
 * would mean two of them overlap. GoodRx carries five and can, because two of
 * them are shopping.
 *
 * **The bar itself is drawn by `SarvTabBar`.** It has to lift the Sarv square
 * above its own top edge, which React Navigation's bar clips.
 */
const Tab = createBottomTabNavigator<MainTabParamList>()

/**
 * The five are written out rather than mapped over a list. A `<Tab.Screen>` is
 * typed against the route it names, so a loop collapses them all to the first
 * one's props and every screen after it stops type-checking against its own
 * route.
 */
export function MainNavigator() {
  return (
    <View style={$root}>
      <Tab.Navigator
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <SarvTabBar {...props} />}
      >
        <Tab.Screen name="Today" component={TodayScreen} />
        <Tab.Screen name="Progress" component={ProgressScreen} />
        {/* Third of five, so it lands dead centre. The screen is the
            conversation itself — a tab that opened a chooser would put a
            decision between the patient and the answer they came for. */}
        <Tab.Screen name="Sarv" component={MessageThreadScreen} />
        <Tab.Screen name="Reports" component={ReportsScreen} />
        <Tab.Screen name="CareTeam" component={CareTeamScreen} />
      </Tab.Navigator>
    </View>
  )
}

const $root: ViewStyle = { flex: 1 }
