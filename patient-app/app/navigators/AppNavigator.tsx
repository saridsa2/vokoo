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
import { MetricDetailScreen } from "@/screens/MetricDetailScreen"
import { PermissionsScreen } from "@/screens/PermissionsScreen"
import { IntelligenceScreen } from "@/screens/IntelligenceScreen"
import { LocalModelScreen } from "@/screens/LocalModelScreen"
import { QuestionnaireScreen } from "@/screens/QuestionnaireScreen"
import { ErrorBoundary } from "@/screens/ErrorScreen/ErrorBoundary"
import { MessageThreadScreen } from "@/screens/MessageThreadScreen"
import { RegisterScreen } from "@/screens/RegisterScreen"
import { RequestDetailScreen } from "@/screens/RequestDetailScreen"
import { SignInScreen } from "@/screens/SignInScreen"
import { useAppTheme } from "@/theme/context"
import { load } from "@/utils/storage"

import { MainNavigator } from "./MainNavigator"
import type { AppStackParamList, NavigationProps } from "./navigationTypes"
import { navigationRef, useBackButtonHandler } from "./navigationUtilities"

/**
 * Routes where the Android back button exits rather than going back.
 */
const exitRoutes = Config.exitRoutes

/** Set once the permissions screen has been seen, whatever was granted. */
export const ONBOARDED_KEY = "onboarded"

const Stack = createNativeStackNavigator<AppStackParamList>()

const AppStack = () => {
  const { isAuthenticated } = useAuth()
  const hasOnboarded = load<boolean>(ONBOARDED_KEY) ?? false

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
      /**
       * Where a signed-in patient lands, and it is not always the app.
       *
       * The permissions screen is shown **once**, on the first launch after
       * signing in. It sits on the signed-in side because the stack swaps the
       * moment authentication succeeds — a screen in the other branch would
       * unmount halfway through being read.
       *
       * `hasOnboarded` is persisted rather than held in state: the whole point
       * of asking once is that it survives the app being closed, and a flag in
       * memory would ask again every launch, which is exactly the behaviour
       * that makes people refuse.
       */
      initialRouteName={isAuthenticated ? (hasOnboarded ? "Main" : "Permissions") : "SignIn"}
    >
      {isAuthenticated ? (
        <>
          <Stack.Screen name="Permissions" component={PermissionsScreen} />
          <Stack.Screen name="Intelligence" component={IntelligenceScreen} />
          <Stack.Screen name="Main" component={MainNavigator} />
          <Stack.Screen name="Questionnaire" component={QuestionnaireScreen} />
          <Stack.Screen name="LocalModel" component={LocalModelScreen} />

          {/**
           * Presented as sheets, which is the whole reason they are stack
           * screens rather than tabs: each is one thing being looked at, and
           * closing it should put the person back exactly where they were.
           */}
          <Stack.Group screenOptions={{ presentation: "modal" }}>
            <Stack.Screen name="RequestDetail" component={RequestDetailScreen} />
            <Stack.Screen name="Cohort" component={CohortScreen} />
            <Stack.Screen name="MetricDetail" component={MetricDetailScreen} />
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
