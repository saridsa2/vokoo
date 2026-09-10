/**
 * The stack: an auth flow, the tabs, and the three things you open over them.
 */
import { NavigationContainer } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"

import Config from "@/config"
import { useAuth } from "@/context/AuthContext"
import { ScrollProvider } from "@/context/ScrollContext"
import { CallScreen } from "@/screens/CallScreen"
import { CohortScreen } from "@/screens/CohortScreen"
import { ErrorBoundary } from "@/screens/ErrorScreen/ErrorBoundary"
import { MessageThreadScreen } from "@/screens/MessageThreadScreen"
import { RegisterScreen } from "@/screens/RegisterScreen"
import { RequestDetailScreen } from "@/screens/RequestDetailScreen"
import { SignInScreen } from "@/screens/SignInScreen"
import { useAppTheme } from "@/theme/context"

import { MainNavigator } from "./MainNavigator"
import type { AppStackParamList, NavigationProps } from "./navigationTypes"
import { navigationRef, useBackButtonHandler } from "./navigationUtilities"

/**
 * Routes where the Android back button exits rather than going back.
 */
const exitRoutes = Config.exitRoutes

const Stack = createNativeStackNavigator<AppStackParamList>()

const AppStack = () => {
  const { isAuthenticated } = useAuth()

  const {
    theme: { colors },
  } = useAppTheme()

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        navigationBarColor: colors.background,
        contentStyle: { backgroundColor: colors.background },
      }}
      initialRouteName={isAuthenticated ? "Main" : "SignIn"}
    >
      {isAuthenticated ? (
        <>
          <Stack.Screen name="Main" component={MainNavigator} />

          {/**
           * Presented as sheets, which is the whole reason they are stack
           * screens rather than tabs: each is one thing being looked at, and
           * closing it should put the person back exactly where they were.
           */}
          <Stack.Group screenOptions={{ presentation: "modal" }}>
            <Stack.Screen name="RequestDetail" component={RequestDetailScreen} />
            <Stack.Screen name="Cohort" component={CohortScreen} />
            <Stack.Screen name="MessageThread" component={MessageThreadScreen} />
            {/* A call holds the microphone, so it is presented like the sheets
                rather than pushed: closing it must end it, and a screen the
                patient can swipe back to is one they can leave running. */}
            <Stack.Screen name="Call" component={CallScreen} />
          </Stack.Group>
        </>
      ) : (
        <>
          <Stack.Screen name="SignIn" component={SignInScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} />
        </>
      )}
    </Stack.Navigator>
  )
}

export const AppNavigator = (props: NavigationProps) => {
  const { navigationTheme } = useAppTheme()

  useBackButtonHandler((routeName) => exitRoutes.includes(routeName))

  return (
    <NavigationContainer ref={navigationRef} theme={navigationTheme} {...props}>
      <ErrorBoundary catchErrors={Config.catchErrors}>
        {/* Above the navigator, so the tab bar and the screen in front of it read
            one scroll offset. See context/ScrollContext. */}
        <ScrollProvider>
          <AppStack />
        </ScrollProvider>
      </ErrorBoundary>
    </NavigationContainer>
  )
}
