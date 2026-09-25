import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  Switch,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/providers/auth-provider";
import { useLocal } from "@/providers/local-provider";
import { useNotifications } from "@/hooks/use-notifications";
import { rebuildRemindersFromStore } from "@/hooks/use-reminders";
import { hapticLight, hapticError } from "@/lib/haptics";
import { exportToShareSheet, importFromPicker } from "@/lib/backup";
import { useTheme } from "@/theme/theme-provider";
import { PALETTES, THEME_LABELS, THEME_NAMES, type ThemeName } from "@/theme/palettes";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

interface SettingRowProps {
  icon: IoniconName;
  label: string;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
  rightElement?: React.ReactNode;
}

function SettingRow({
  icon,
  label,
  value,
  onPress,
  destructive,
  rightElement,
}: SettingRowProps) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 13,
        paddingHorizontal: 16,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          backgroundColor: destructive ? colors.danger + "20" : colors.primary + "20",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons
          name={icon}
          size={17}
          color={destructive ? colors.danger : colors.primary}
        />
      </View>
      <Text
        style={{
          flex: 1,
          fontSize: 15,
          color: destructive ? colors.danger : colors.foreground,
          fontWeight: "500",
        }}
      >
        {label}
      </Text>
      {rightElement ?? (
        <>
          {value && (
            <Text style={{ fontSize: 13, color: colors.textMuted }}>{value}</Text>
          )}
          {!destructive && onPress && (
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          )}
        </>
      )}
    </TouchableOpacity>
  );
}

function SectionHeader({ title }: { title: string }) {
  const { colors } = useTheme();
  return (
    <Text
      style={{
        fontSize: 11,
        fontWeight: "600",
        color: colors.textMuted,
        textTransform: "uppercase",
        letterSpacing: 0.8,
        paddingHorizontal: 20,
        marginTop: 20,
        marginBottom: 6,
      }}
    >
      {title}
    </Text>
  );
}

function SectionCard({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        marginHorizontal: 20,
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
}

function Divider() {
  const { colors } = useTheme();
  return (
    <View
      style={{ height: 1, backgroundColor: colors.border, marginLeft: 60 }}
    />
  );
}

function ThemeSwatch({
  name,
  active,
  onPress,
}: {
  name: ThemeName;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const palette = PALETTES[name];
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{ alignItems: "center", gap: 6, width: 60 }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: palette.background,
          borderWidth: 3,
          borderColor: palette.primary,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {active && (
          <Ionicons name="checkmark-circle" size={20} color={palette.primary} />
        )}
      </View>
      <Text
        style={{
          fontSize: 12,
          fontWeight: active ? "700" : "500",
          color: active ? colors.foreground : colors.textSecondary,
        }}
      >
        {THEME_LABELS[name]}
      </Text>
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const { store, userId } = useLocal();
  const { isGranted, isLoading, requestPermission, sendTest } =
    useNotifications();
  const [notifEnabled, setNotifEnabled] = useState(false);
  const queryClient = useQueryClient();
  const { name: activeTheme, colors, setTheme } = useTheme();

  async function handleThemeChange(next: ThemeName) {
    hapticLight();
    try {
      await setTheme(next);
    } catch (e) {
      console.warn("Failed to save theme", e);
    }
  }

  function handleSignOut() {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: signOut },
    ]);
  }

  async function handleNotificationsToggle(value: boolean) {
    hapticLight();
    if (value) {
      if (!isGranted) {
        const granted = await requestPermission();
        if (!granted) {
          Alert.alert(
            "Permission required",
            "Enable notifications in your device Settings to receive habit reminders.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Open Settings",
                onPress: () => Linking.openSettings(),
              },
            ]
          );
          return;
        }
      }
      setNotifEnabled(true);
      await rebuildRemindersFromStore(store, userId);
    } else {
      setNotifEnabled(false);
    }
  }

  async function handleTestNotification() {
    if (!isGranted) {
      hapticError();
      Alert.alert(
        "Notifications off",
        "Enable notifications first to test them."
      );
      return;
    }
    await sendTest();
    Alert.alert("Test sent", "You'll receive a test notification in 3 seconds.");
  }

  async function handleExport() {
    hapticLight();
    try {
      await exportToShareSheet(store, userId);
    } catch (e) {
      hapticError();
      Alert.alert("Export failed", e instanceof Error ? e.message : String(e));
    }
  }

  async function handleImport() {
    hapticLight();
    try {
      const result = await importFromPicker(store, userId);
      if (!result) return;
      await queryClient.invalidateQueries();
      await rebuildRemindersFromStore(store, userId);
      Alert.alert("Import complete", `${result.imported} items restored, ${result.skipped} already up to date.`);
    } catch (e) {
      hapticError();
      Alert.alert("Import failed", e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
    >
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 8,
        }}
      >
        <Text style={{ fontSize: 26, fontWeight: "700", color: colors.foreground }}>
          Settings
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 48 }}
      >
        {/* Account */}
        <SectionHeader title="Account" />
        <SectionCard>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: colors.primary + "20",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{ fontSize: 16, fontWeight: "700", color: colors.primary }}
              >
                {user?.email?.[0]?.toUpperCase() ?? "U"}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}
                numberOfLines={1}
              >
                {user.email ?? "Local profile"}
              </Text>
              <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 1 }}>
                {user.email
                  ? `Member since ${new Date(user.created_at).getFullYear()}`
                  : "Stored on this device"}
              </Text>
            </View>
          </View>
        </SectionCard>

        {/* Appearance */}
        <SectionHeader title="Appearance" />
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            marginHorizontal: 20,
            paddingHorizontal: 4,
          }}
        >
          {THEME_NAMES.map((themeName) => (
            <ThemeSwatch
              key={themeName}
              name={themeName}
              active={activeTheme === themeName}
              onPress={() => handleThemeChange(themeName)}
            />
          ))}
        </View>

        {/* Notifications */}
        <SectionHeader title="Notifications" />
        <SectionCard>
          <SettingRow
            icon="notifications-outline"
            label="Habit reminders"
            rightElement={
              <Switch
                value={notifEnabled}
                onValueChange={handleNotificationsToggle}
                trackColor={{ false: colors.switchTrackOff, true: colors.primary }}
                thumbColor={colors.onPrimary}
                disabled={isLoading}
              />
            }
          />
          <Divider />
          <SettingRow
            icon="flask-outline"
            label="Send test notification"
            onPress={handleTestNotification}
          />
        </SectionCard>

        {/* Data */}
        <SectionHeader title="Data" />
        <SectionCard>
          <SettingRow icon="download-outline" label="Export data" onPress={handleExport} />
          <Divider />
          <SettingRow icon="cloud-upload-outline" label="Import data" onPress={handleImport} />
        </SectionCard>

        {/* App */}
        <SectionHeader title="App" />
        <SectionCard>
          <SettingRow
            icon="globe-outline"
            label="Timezone"
            value="Auto"
          />
          <Divider />
          <SettingRow
            icon="information-circle-outline"
            label="Version"
            value="1.0.0"
          />
        </SectionCard>

        {/* Danger */}
        {user.email ? (
          <View style={{ marginHorizontal: 20, marginTop: 20 }}>
            <TouchableOpacity
              onPress={handleSignOut}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                paddingVertical: 14,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: colors.danger + "40",
                backgroundColor: colors.danger + "10",
              }}
            >
              <Ionicons name="log-out-outline" size={18} color={colors.danger} />
              <Text
                style={{ fontSize: 15, fontWeight: "600", color: colors.danger }}
              >
                Sign out
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <Text
          style={{
            textAlign: "center",
            color: colors.textMuted,
            fontSize: 12,
            marginTop: 24,
          }}
        >
          rock v1.0.0
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
