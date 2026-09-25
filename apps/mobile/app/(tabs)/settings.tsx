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
          backgroundColor: destructive ? "#ef444420" : "#6366f120",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons
          name={icon}
          size={17}
          color={destructive ? "#ef4444" : "#6366f1"}
        />
      </View>
      <Text
        style={{
          flex: 1,
          fontSize: 15,
          color: destructive ? "#ef4444" : "#f4f4f8",
          fontWeight: "500",
        }}
      >
        {label}
      </Text>
      {rightElement ?? (
        <>
          {value && (
            <Text style={{ fontSize: 13, color: "#6b7280" }}>{value}</Text>
          )}
          {!destructive && onPress && (
            <Ionicons name="chevron-forward" size={16} color="#6b7280" />
          )}
        </>
      )}
    </TouchableOpacity>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Text
      style={{
        fontSize: 11,
        fontWeight: "600",
        color: "#6b7280",
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
  return (
    <View
      style={{
        marginHorizontal: 20,
        backgroundColor: "#111118",
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "#1e1e2a",
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
}

function Divider() {
  return (
    <View
      style={{ height: 1, backgroundColor: "#1e1e2a", marginLeft: 60 }}
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
          color: active ? "#f4f4f8" : "#9ca3af",
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
  const { name: activeTheme, setTheme } = useTheme();

  async function handleThemeChange(next: ThemeName) {
    hapticLight();
    await setTheme(next);
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
      style={{ flex: 1, backgroundColor: "#0a0a0f" }}
      edges={["top"]}
    >
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 8,
        }}
      >
        <Text style={{ fontSize: 26, fontWeight: "700", color: "#f4f4f8" }}>
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
              borderBottomColor: "#1e1e2a",
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: "#6366f120",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{ fontSize: 16, fontWeight: "700", color: "#6366f1" }}
              >
                {user?.email?.[0]?.toUpperCase() ?? "U"}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{ fontSize: 14, fontWeight: "600", color: "#f4f4f8" }}
                numberOfLines={1}
              >
                {user.email ?? "Local profile"}
              </Text>
              <Text style={{ fontSize: 12, color: "#6b7280", marginTop: 1 }}>
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
                trackColor={{ false: "#2d2d3a", true: "#6366f1" }}
                thumbColor="white"
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
                borderColor: "#ef444440",
                backgroundColor: "#ef444410",
              }}
            >
              <Ionicons name="log-out-outline" size={18} color="#ef4444" />
              <Text
                style={{ fontSize: 15, fontWeight: "600", color: "#ef4444" }}
              >
                Sign out
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <Text
          style={{
            textAlign: "center",
            color: "#6b7280",
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
