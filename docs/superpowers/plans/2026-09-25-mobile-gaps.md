# Mobile Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three gaps found during the APK smoke test:
1. The bottom sheet can't be scrolled.
2. Creating a habit has no reminder time, and habit edits never (re)schedule reminders.
3. There is no theme switcher. The product spec requires Light, Dark, Midnight, Forest and Sunset.

**Architecture:** The bottom sheet's drag gesture moves from the whole sheet to its handle and header, so the content `ScrollView` owns vertical drags. Reminders are set in `mobile-habit-form.tsx` with the platform time picker, and `use-habits.ts` (re)schedules or cancels a habit's reminder after every mutation. Themes live in `apps/mobile/theme/`: five palettes, a `ThemeProvider` driven by `profile.theme` from the local store, and a `useTheme()` hook. Screens take colors from `useTheme().colors` instead of hex literals. NativeWind classes read the same palette through CSS variables set with `vars()` on the root view.

**Tech Stack:** Expo SDK 55, React Native (new arch), expo-router, react-native-gesture-handler + reanimated, NativeWind 4, `@react-native-community/datetimepicker`, expo-notifications.

## Global Constraints

- The **Dark** palette must equal the colors the app uses today (listed in Task 3), so existing users see no visual change.
- Palette values are exactly the ones in Task 3's table. They are derived from `apps/web/styles/globals.css`.
- Theme choice persists in the local profile (`profiles.theme`: `"light" | "dark" | "midnight" | "forest" | "sunset"`), through `useProfile().updateProfile({ theme })`.
- Reminder time format is `"HH:mm"` (24h), which is what `reminderTriggers` in `@rock_ht/utils` consumes. Check its signature before use.
- No hex color literals remain in `apps/mobile/app/**` and `apps/mobile/components/**`, except user-chosen habit colors (the habit color palette in the form) and `#ffffff` text on a `primary`/habit-color fill, which may use `colors.onPrimary`.
- The phone `RZCXA1ZEXJE` holds real user data. On it: install and read-only navigation only. All interactive testing happens on `emulator-5554` (the arm64 APK runs there).
- Build and install with `scripts/build-apk.sh` (see `--help`). Two devices are attached, so always pass a serial.
- `npm run type-check` and `npm run lint` from the repo root must pass.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01XD64vPnTySw8Fk82cmxSNs`

---

### Task 1: Bottom sheet content scrolls

**Files:**
- Modify: `apps/mobile/components/ui/bottom-sheet.tsx`

**Problem:** `<GestureDetector gesture={panGesture}>` wraps the whole sheet, including the `ScrollView`. The pan gesture wins every vertical drag, so long sheets such as the new-habit form can't be scrolled.

- [ ] **Step 1: Move the detector to the handle and header**

Wrap only the drag handle and the header in the `GestureDetector`, and leave the `KeyboardAvoidingView`/`ScrollView` outside it:

```tsx
<Animated.View style={[sheetStyle, { height: sheetHeight + insets.bottom, position: "absolute", bottom: 0, left: 0, right: 0 }]} className="bg-card rounded-t-3xl shadow-2xl">
  <GestureDetector gesture={panGesture}>
    <View>
      {/* Drag handle */}
      <View className="items-center pt-3 pb-1">
        <View className="w-10 h-1 rounded-full bg-muted-foreground/30" />
      </View>
      {/* Header */}
      {title && ( /* unchanged header */ )}
    </View>
  </GestureDetector>

  <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
      {children}
    </ScrollView>
  </KeyboardAvoidingView>
</Animated.View>
```

The `<View>` wrapper is needed because `GestureDetector` takes a single child.

- [ ] **Step 2: Verify on the emulator**

Build and install on the emulator: `scripts/build-apk.sh --install emulator-5554`. Open Habits, then "+" to open the new-habit sheet. Swipe up inside the form with `adb -s emulator-5554 shell input swipe 540 1800 540 700 300`. Take a screenshot: the lower fields (frequency and below) are now visible. Then drag down from the handle (`input swipe 540 <handleY> 540 2000 300`): the sheet closes. Backdrop taps still close it.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/components/ui/bottom-sheet.tsx
git commit -m "fix(mobile): let bottom sheet content scroll; drag to close from the handle"
```

---

### Task 2: Reminder time in the habit form, scheduled on save

**Files:**
- Modify: `apps/mobile/package.json` (via `npx expo install @react-native-community/datetimepicker`, run in `apps/mobile`)
- Modify: `apps/mobile/components/habits/mobile-habit-form.tsx`
- Modify: `apps/mobile/hooks/use-habits.ts`
- Read (don't change unless needed): `apps/mobile/lib/notifications.ts` (`scheduleHabitReminder`, `cancelHabitReminder`), `apps/mobile/hooks/use-reminders.ts`, `apps/mobile/hooks/use-notifications.ts`, `apps/mobile/app/(tabs)/settings.tsx` (the global "Habit reminders" toggle), `packages/utils` (`reminderTriggers`).

**Interfaces:**
- Consumes: `CreateHabitInput.reminder_time?: string` (`"HH:mm"`) and `reminder_enabled?: boolean` from `@rock_ht/types`.
- Consumes: `scheduleHabitReminder(habit: ReminderHabit): Promise<string[]>` and `cancelHabitReminder(id)` from `lib/notifications.ts`.

- [ ] **Step 1: Install the picker**

In `apps/mobile`, run `npx expo install @react-native-community/datetimepicker`. It's a native module, so autolinking picks it up in the next gradle build. Commit `package.json` and the lockfile together with this task.

- [ ] **Step 2: Form fields**

Changes to `mobile-habit-form.tsx`:
- Extend the zod schema with `reminderEnabled: z.boolean()` and `reminderTime: z.string().regex(/^\d{2}:\d{2}$/)`.
- Defaults: `initial?.reminder_enabled ?? false` and `initial?.reminder_time?.slice(0, 5) ?? "09:00"`. Some stored values may be `"HH:mm:ss"`, hence the slice.
- Below the frequency section, add a "Reminder" row: a label, a React Native `Switch` bound to `reminderEnabled`, and, when enabled, a pressable time chip that shows the time (e.g. "09:00").
- Pressing the chip shows `DateTimePicker` with `mode="time"`, `is24Hour`, and a `value` built from `reminderTime`. On Android, render it only while a `showTimePicker` state is true (it's a dialog). Set the state back to false in `onChange` whatever the event type. On `event.type === "set"`, write `HH:mm` from the selected date's local hours and minutes.
- When the switch turns on, request notification permission through the existing hook or helper in `use-notifications.ts` / `lib/notifications.ts`. If it's denied, keep the switch on but show the same "Enable notifications in your device Settings…" hint that Settings uses.
- In the submit handler, pass `reminder_enabled: data.reminderEnabled` and `reminder_time: data.reminderEnabled ? data.reminderTime : undefined`.

Style the new row with the same inline-style idiom and colors as the neighbouring frequency controls. Task 4 will convert all colors to theme tokens.

- [ ] **Step 3: Schedule after mutations**

In `use-habits.ts`, after each successful mutation, read the saved habit row (the mutation result, or `store.getHabit` if the mutation returns nothing) and:
- **create/update:** `await scheduleHabitReminder(habit)`. It already cancels the old ones and schedules nothing when `reminder_enabled` is false, `reminder_time` is missing, or the habit is archived.
- **archive/delete:** `await cancelHabitReminder(id)`.
- Respect the global "Habit reminders" setting from Settings. Find where it is stored. If it's off, skip scheduling, as `rebuildRemindersFromStore` does.
- Wrap each call in `try/catch` with `console.warn`. A notification failure must never fail the mutation or roll back the optimistic UI.

- [ ] **Step 4: Verify on the emulator**

Type-check first: `npm run type-check`. Then build and install on the emulator. Checks:
1. Create a habit "Remind test" with the reminder on, set 2 minutes ahead through the picker dialog. Grant the permission if asked.
2. `adb -s emulator-5554 shell dumpsys alarm | grep -c rockht` shows an alarm count that increased.
3. Wait for the notification (screenshot the shade: `adb -s emulator-5554 shell cmd statusbar expand-notifications`).
4. Edit the habit and turn the reminder off. The alarm count drops back.
5. Delete the habit.
6. Clear the log with `adb -s emulator-5554 logcat -c` before starting, and check `adb logcat -d -b crash` at the end: it should be empty.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/package.json package-lock.json apps/mobile/components/habits/mobile-habit-form.tsx apps/mobile/hooks/use-habits.ts
git commit -m "feat(mobile): set a reminder time per habit and schedule it on save"
```

---

### Task 3: Theme infrastructure and switcher

**Files:**
- Create: `apps/mobile/theme/palettes.ts`
- Create: `apps/mobile/theme/theme-provider.tsx`
- Modify: `apps/mobile/tailwind.config.js` (colors read CSS variables)
- Modify: `apps/mobile/app/_layout.tsx` (mount the provider)
- Modify: `apps/mobile/app/(tabs)/_layout.tsx` (tab bar colors from the theme)
- Modify: `apps/mobile/app/(tabs)/settings.tsx` (appearance picker)

**Interfaces:**
- Produces: `type ThemeName = "light" | "dark" | "midnight" | "forest" | "sunset"`
- Produces: `interface Palette { background; card; muted; border; elevated; foreground; textSecondary; textMuted; primary; onPrimary; danger; warning; streak; success: string; statusBar: "light" | "dark" }`
- Produces: `PALETTES: Record<ThemeName, Palette>` and `THEME_NAMES: ThemeName[]`
- Produces: `useTheme(): { name: ThemeName; colors: Palette; setTheme(name: ThemeName): Promise<void> }`

- [ ] **Step 1: Palettes**

`apps/mobile/theme/palettes.ts`. The Dark palette is exactly today's hard-coded colors. The other palettes are ported from the web's `globals.css`.

| token | dark | light | midnight | forest | sunset |
|---|---|---|---|---|---|
| background | `#0a0a0f` | `#fafafa` | `#000000` | `#0a100d` | `#110b09` |
| card | `#111118` | `#ffffff` | `#111113` | `#121c17` | `#1d1511` |
| muted | `#1e1e2a` | `#f4f4f5` | `#1d1d20` | `#1e2924` | `#2b211d` |
| border | `#1e1e2a` | `#e4e4e7` | `#1f1f23` | `#212c26` | `#2d241f` |
| elevated | `#2d2d3a` | `#e4e4e7` | `#2a2a2f` | `#2b3a32` | `#3a2d27` |
| foreground | `#f4f4f8` | `#17171c` | `#dfdfe2` | `#e0ebe4` | `#ebe6e0` |
| textSecondary | `#9ca3af` | `#52525b` | `#a1a1aa` | `#a3b8aa` | `#bfb2a5` |
| textMuted | `#6b6b80` | `#71717a` | `#6e6e77` | `#708f7a` | `#897a6c` |
| primary | `#6366f1` | `#5048e5` | `#9b6af1` | `#21c45d` | `#ec417a` |
| statusBar | `light` | `dark` | `light` | `light` | `light` |

The shared values are the same in every palette: `onPrimary #ffffff`, `danger #ef4444`, `warning #f59e0b`, `streak #f97316`, `success #22c55e`.

```ts
export type ThemeName = "light" | "dark" | "midnight" | "forest" | "sunset";
export const THEME_NAMES: ThemeName[] = ["dark", "light", "midnight", "forest", "sunset"];
export const THEME_LABELS: Record<ThemeName, string> = {
  dark: "Dark", light: "Light", midnight: "Midnight", forest: "Forest", sunset: "Sunset",
};
export interface Palette { /* fields as in Interfaces */ }
const shared = { onPrimary: "#ffffff", danger: "#ef4444", warning: "#f59e0b", streak: "#f97316", success: "#22c55e" };
export const PALETTES: Record<ThemeName, Palette> = { /* one entry per column above, spread `shared` */ };
```

Fill in all five entries from the table. Don't abbreviate.

- [ ] **Step 2: Provider**

`apps/mobile/theme/theme-provider.tsx`:
- The theme name is `profile?.theme` from `useProfile()`. Fall back to `"dark"` while the profile is loading or when the value is unknown.
- `setTheme(name)` calls `updateProfile({ theme: name })`.
- Render `<View style={[{ flex: 1, backgroundColor: colors.background }, vars(cssVars)]}>{children}</View>`. `vars` comes from `nativewind`, and `cssVars` maps `--background`, `--card`, `--muted`, `--border`, `--foreground`, `--muted-foreground` (textMuted) and `--primary` to space-separated RGB channels (e.g. `"10 10 15"`) computed from the hex values.
- Also render `<StatusBar style={colors.statusBar} />` from `expo-status-bar`, and remove the per-screen `<StatusBar style="light" />` in `app/(tabs)/index.tsx`.
- Memoize the context value.

- [ ] **Step 3: Tailwind reads the variables**

In `tailwind.config.js`, replace the fixed theme colors with `"rgb(var(--background) / <alpha-value>)"`, and the same for `card`, `muted`, `border`, `foreground` and `primary`. Add `"muted-foreground": "rgb(var(--muted-foreground) / <alpha-value>)"`. `bottom-sheet.tsx` uses `text-muted-foreground`/`bg-muted-foreground/30`, which don't exist today. Keep `muted-fg` as an alias of the same variable. `success`/`streak` stay fixed hex values.

- [ ] **Step 4: Mount, tab bar, settings picker**

- `app/_layout.tsx`: wrap `<OnboardingGuard />` in `<ThemeProvider>` inside `AppProviders`. It needs the store and profile, so it can't sit above them.
- `app/(tabs)/_layout.tsx`: take `tabBarActiveTintColor` from `colors.primary`, `tabBarInactiveTintColor` from `colors.textMuted`, the bar `backgroundColor` from `colors.card` and `borderTopColor` from `colors.border`. Also set `sceneStyle: { backgroundColor: colors.background }` in `screenOptions`, so tab switches don't flash a dark background in light mode.
- `app/(tabs)/settings.tsx`: add an "Appearance" section above the notifications section. It is a row of five swatches, each a 44px circle filled with that palette's `background` with a 3px ring in its `primary`, plus the label underneath. The active theme gets a check or a thicker ring. A tap calls `setTheme(name)` and `hapticLight` if the file already uses haptics. Take the section title and row styling from the existing settings sections.

- [ ] **Step 5: Verify on the emulator**

Run `npm run type-check`, then build and install on the emulator. In Settings, tap each theme. The tab bar, the Settings background and the status bar icons follow it, and Light gives dark status-bar icons. Force-stop and relaunch: the choice persists. Screenshot Light and Forest. Other screens will still be dark until Task 4, which is expected.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/theme apps/mobile/tailwind.config.js apps/mobile/app/_layout.tsx "apps/mobile/app/(tabs)/_layout.tsx" "apps/mobile/app/(tabs)/settings.tsx" "apps/mobile/app/(tabs)/index.tsx"
git commit -m "feat(mobile): theme system with Light, Dark, Midnight, Forest and Sunset"
```

---

### Task 4: Screens use theme colors

**Files (every file with hex literals):**
- `apps/mobile/app/(tabs)/index.tsx`, `habits.tsx`, `analytics.tsx`, `journal.tsx`, `settings.tsx`
- `apps/mobile/app/habit/[id].tsx`, `apps/mobile/app/onboarding.tsx`
- `apps/mobile/components/habits/*.tsx`, `apps/mobile/components/ui/bottom-sheet.tsx`

Find them with: `grep -rln '#[0-9a-fA-F]\{3,8\}' apps/mobile/app apps/mobile/components`

**Interfaces:**
- Consumes: `useTheme()` from `apps/mobile/theme/theme-provider.tsx` and `Palette` from `palettes.ts` (Task 3).

- [ ] **Step 1: Replace literals with tokens**

In each component, add `const { colors } = useTheme();` and replace the literals using this mapping:

| literal | token |
|---|---|
| `#0a0a0f` | `colors.background` |
| `#111118` | `colors.card` |
| `#1e1e2a` as a background (chips, inputs, tracks) | `colors.muted` |
| `#1e1e2a` as a border color | `colors.border` |
| `#2d2d3a` | `colors.elevated` |
| `#f4f4f8`, `#d1d5db` | `colors.foreground` |
| `#9ca3af` | `colors.textSecondary` |
| `#6b6b80`, `#6b7280`, `#4b5563` | `colors.textMuted` |
| `#6366f1` (UI accent: links, buttons, selected states, ring) | `colors.primary` |
| `white`/`#fff`/`#ffffff` on a primary or habit-color fill | `colors.onPrimary` |
| `#ef4444`, `#f87171` | `colors.danger` |
| `#f59e0b` | `colors.warning` |
| `#f97316` | `colors.streak` |

Exceptions:
- Keep the literals that are user-selectable habit colors: the color options in `mobile-habit-form.tsx`, and the default habit color if it is `#6366f1` used as data. Only UI chrome moves to tokens.
- Styles in module-level `StyleSheet.create` objects that use these colors must move into the component. Do it either inline or with a `makeStyles(colors)` function memoized with `useMemo`. Pick whichever the file already leans towards.
- Text or icons that sit on the always-dark translucent `bg-black/60` backdrop are fine as they are.

- [ ] **Step 2: No literals left**

Run: `grep -rn '#[0-9a-fA-F]\{3,8\}\b' apps/mobile/app apps/mobile/components`
Expected: only the habit color options and default habit color in `mobile-habit-form.tsx` (and any `onboarding.tsx` habit presets that are data). Review each remaining hit.

- [ ] **Step 3: Verify every screen in every theme on the emulator**

Run `npm run type-check` and `npm run lint`, then build and install on the emulator. For **Light** and **Sunset**, screenshot these screens:
- Today, Habits, Stats, Journal, Settings
- habit detail
- the new-habit sheet
- onboarding, if reachable (e.g. on a fresh `pm clear` of the emulator app only)

Look at each screenshot for unreadable text (light-on-light or dark-on-dark), leftover dark panels in Light, and invisible borders. Fix anything you find and re-screenshot. Then switch back to **Dark** and compare Today and Settings with a screenshot taken before Task 3, which should look identical. Clear logcat at the start and read the crash buffer at the end.

- [ ] **Step 4: Phone check (read-only)**

Run `scripts/build-apk.sh --install RZCXA1ZEXJE`. Launch the app, wait 8s and take a screenshot. The app is still Dark, since the profile default is `dark`, with the habits intact. The crash buffer should be empty. Don't change the theme on the phone; the user will.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app apps/mobile/components
git commit -m "feat(mobile): draw every screen from the active theme palette"
```

---

## Self-review

- Gap 1, scrolling: Task 1. Gap 2, reminder time: Task 2, which also fixes reminders not being rescheduled after edits. Gap 3, themes: Tasks 3 and 4, with all five spec themes, persisted per profile.
- The Dark palette is equal to today's colors, so there is no change for existing users (checked in Task 4 Step 3).
- Out of scope: the web theme toggle (it already exists); following the system light/dark setting ("auto"), which the spec doesn't list; and syncing the theme across devices (the sync plan M2 handles profiles).
