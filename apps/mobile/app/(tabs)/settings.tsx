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
import { useAuth } from "@/providers/supabase-provider";
import { useNotifications } from "@/hooks/use-notifications";
import { hapticLight, hapticError } from "@/lib/haptics";

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

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const { isGranted, isLoading, requestPermission, sendTest } =
    useNotifications();
  const [notifEnabled, setNotifEnabled] = useState(false);

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
                {user?.email}
              </Text>
              <Text style={{ fontSize: 12, color: "#6b7280", marginTop: 1 }}>
                Member since{" "}
                {user?.created_at
                  ? new Date(user.created_at).getFullYear()
                  : "—"}
              </Text>
            </View>
          </View>
        </SectionCard>

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
