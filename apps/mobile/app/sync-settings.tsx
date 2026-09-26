import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Keyboard,
  KeyboardAvoidingView,
  ActivityIndicator,
  ScrollView,
  type TextInputProps,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Sentry from "@sentry/react-native";
import { useLocal } from "@/providers/local-provider";
import { useSync } from "@/hooks/use-sync";
import { rebuildRemindersFromStore } from "@/hooks/use-reminders";
import { describeSyncConfig, loadSyncConfig, type SyncConfig } from "@/lib/sync/config";
import { connectSync, disconnectSync } from "@/lib/sync/account";
import { dismissSyncWarning, refreshSyncState, syncNow } from "@/lib/sync/service";
import { hapticError, hapticLight, hapticSuccess } from "@/lib/haptics";
import { useTheme } from "@/theme/theme-provider";

type Kind = SyncConfig["kind"];
type Mode = "signin" | "signup";

const KINDS: { kind: Kind; label: string }[] = [
  { kind: "off", label: "Off" },
  { kind: "selfhost", label: "Self-hosted" },
  { kind: "supabase", label: "Supabase" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatLastSynced(at: string | null): string {
  if (!at) return "Not synced yet";
  const d = new Date(at);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "Synced just now";
  if (mins < 60) return `Synced ${mins} min ago`;
  return `Synced ${d.toLocaleString()}`;
}

function Field({
  label,
  hint,
  ...input
}: TextInputProps & { label: string; hint?: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13, fontWeight: "500", color: colors.foreground }}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          height: 44,
          paddingHorizontal: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          color: colors.foreground,
          fontSize: 14,
        }}
        {...input}
      />
      {hint}
    </View>
  );
}

function Segmented({ value, onChange }: { value: Kind; onChange: (k: Kind) => void }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: colors.muted,
        borderRadius: 12,
        padding: 3,
      }}
    >
      {KINDS.map(({ kind, label }) => {
        const active = kind === value;
        return (
          <TouchableOpacity
            key={kind}
            onPress={() => { hapticLight(); onChange(kind); }}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderRadius: 9,
              alignItems: "center",
              backgroundColor: active ? colors.card : "transparent",
              borderWidth: active ? 1 : 0,
              borderColor: colors.border,
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: active ? "700" : "500",
                color: active ? colors.foreground : colors.textSecondary,
              }}
            >
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Button({
  label,
  onPress,
  busy,
  disabled,
  variant = "primary",
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
}) {
  const { colors } = useTheme();
  const bg = variant === "primary" ? colors.primary : variant === "danger" ? colors.danger + "10" : "transparent";
  const border = variant === "primary" ? colors.primary : variant === "danger" ? colors.danger + "40" : colors.border;
  const fg = variant === "primary" ? colors.onPrimary : variant === "danger" ? colors.danger : colors.foreground;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy || disabled}
      activeOpacity={0.85}
      style={{
        height: 44,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
        opacity: disabled && !busy ? 0.5 : 1,
      }}
    >
      {busy ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <Text style={{ color: fg, fontWeight: "600", fontSize: 14 }}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

export default function SyncSettingsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { store, refreshUserId } = useLocal();
  const sync = useSync();

  const [saved, setSaved] = useState<SyncConfig | null>(null);
  const [kind, setKind] = useState<Kind>("off");
  const [mode, setMode] = useState<Mode>("signin");
  const [url, setUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hadOtherAccount, setHadOtherAccount] = useState(false);

  useEffect(() => {
    void loadSyncConfig().then((c) => {
      setSaved(c);
      setKind(c.kind);
      if (c.kind === "selfhost") setUrl(c.baseUrl);
      if (c.kind === "supabase") { setUrl(c.url); setAnonKey(c.anonKey); }
    });
    // Non-empty whenever this device's rows have been claimed by any account before (see
    // `LocalStore.previousAccounts`), so signing in again — to that account or a new one — copies
    // this device's data in under (possibly new) ids rather than starting from an empty account.
    void store.previousAccounts().then((accounts) => setHadOtherAccount(accounts.length > 0));
  }, [store]);

  // Connected = a backend is saved and an account is signed in on this device.
  const connected = saved !== null && saved.kind !== "off" && sync.status !== "off";

  function validate(): string | null {
    if (!/^https?:\/\/\S+/i.test(url.trim())) return "Enter a server URL starting with https:// or http://";
    if (kind === "supabase" && !anonKey.trim()) return "Enter the project's anon key";
    if (!EMAIL_RE.test(email.trim())) return "Enter a valid email";
    if (mode === "signup" && password.length < 8) return "Password must be at least 8 characters";
    if (mode === "signin" && !password) return "Enter your password";
    if (mode === "signup" && !name.trim()) return "Enter your name";
    return null;
  }

  async function connect() {
    Keyboard.dismiss();
    const invalid = validate();
    if (invalid) { hapticError(); setError(invalid); return; }
    const config: SyncConfig =
      kind === "selfhost" ? { kind, baseUrl: url.trim().replace(/\/+$/, "") }
      : kind === "supabase" ? { kind, url: url.trim().replace(/\/+$/, ""), anonKey: anonKey.trim() }
      : { kind: "off" };
    setError(null);
    setBusy("connect");
    try {
      const accountId = await connectSync(store, config, { mode, email, password, name });
      setSaved(config);
      await refreshUserId();
      await refreshSyncState();
      await syncNow();
      await rebuildRemindersFromStore(store, accountId).catch((e) => Sentry.captureException(e));
      hapticSuccess();
      router.back();
    } catch (e) {
      hapticError();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setError(null);
    setBusy("disconnect");
    try {
      await disconnectSync(store);
      await refreshUserId();
      setSaved({ kind: "off" });
      setKind("off");
      setPassword("");
      hapticLight();
    } catch (e) {
      hapticError();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const insecure = url.trim().toLowerCase().startsWith("http://");

  const errorBox = error ? (
    <View
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.danger + "40",
        backgroundColor: colors.danger + "10",
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <Text style={{ fontSize: 13, color: colors.danger }}>{error}</Text>
    </View>
  ) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 }}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={{ alignSelf: "flex-start" }}>
          <Text style={{ color: colors.primary, fontSize: 16 }}>← Back</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 26, fontWeight: "700", color: colors.foreground, marginTop: 12 }}>
          Sync
        </Text>
        <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 4, lineHeight: 18 }}>
          Optional. rock works fully offline; connect a server to back up your habits and use them on
          more than one device.
        </Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 20, paddingBottom: 40 + insets.bottom, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {saved === null ? null : connected ? (
            <View
              style={{
                backgroundColor: colors.card,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 16,
                gap: 14,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    backgroundColor:
                      (sync.status === "error"
                        ? colors.danger
                        : sync.status === "signed-out" || sync.status === "warning"
                          ? colors.warning
                          : colors.primary) + "20",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons
                    name={
                      sync.status === "error" || sync.status === "signed-out"
                        ? "cloud-offline-outline"
                        : sync.status === "warning"
                          ? "alert-circle-outline"
                          : "cloud-done-outline"
                    }
                    size={18}
                    color={
                      sync.status === "error"
                        ? colors.danger
                        : sync.status === "signed-out" || sync.status === "warning"
                          ? colors.warning
                          : colors.primary
                    }
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>
                    {describeSyncConfig(saved)}
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      color: sync.status === "signed-out" ? colors.warning : colors.textMuted,
                      marginTop: 2,
                    }}
                  >
                    {sync.status === "syncing"
                      ? "Syncing…"
                      : sync.status === "signed-out"
                        ? "Signed out — sign in again"
                        : formatLastSynced(sync.lastSyncedAt)}
                  </Text>
                </View>
              </View>
              {sync.status === "error" && sync.error ? (
                <Text style={{ fontSize: 13, color: colors.danger }}>Last sync failed: {sync.error}</Text>
              ) : null}
              {sync.warning && sync.status !== "off" ? (
                <View style={{ gap: 6 }}>
                  <Text style={{ fontSize: 13, color: colors.warning }}>
                    {sync.warning}. Those changes stay on this device but won't reach your account.
                  </Text>
                  <TouchableOpacity onPress={() => { hapticLight(); void dismissSyncWarning(); }} hitSlop={8}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.textMuted }}>Dismiss</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {errorBox}
              {sync.status !== "signed-out" ? (
                <Button label="Sync now" onPress={sync.syncNow} busy={sync.status === "syncing"} />
              ) : null}
              <Button label="Disconnect" variant="danger" onPress={disconnect} busy={busy === "disconnect"} />
              <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 17 }}>
                Disconnecting keeps all your data on this device. Changes made while disconnected upload
                when you sign in to the same account again.
              </Text>
            </View>
          ) : (
            <>
              <Segmented value={kind} onChange={(k) => { setKind(k); setError(null); }} />

              {kind === "off" ? (
                <>
                  <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", paddingHorizontal: 4 }}>
                    <Ionicons name="phone-portrait-outline" size={16} color={colors.textMuted} style={{ marginTop: 1 }} />
                    <Text style={{ flex: 1, fontSize: 13, color: colors.textSecondary, lineHeight: 18 }}>
                      Sync is off. Everything stays on this device; use Settings → Export data for backups.
                    </Text>
                  </View>
                  {saved && saved.kind !== "off" ? (
                    <>
                      {errorBox}
                      <Button
                        label="Turn sync off"
                        variant="danger"
                        onPress={disconnect}
                        busy={busy === "disconnect"}
                      />
                    </>
                  ) : null}
                </>
              ) : (
                <View
                  style={{
                    backgroundColor: colors.card,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: 16,
                    gap: 14,
                  }}
                >
                  <Field
                    label={kind === "selfhost" ? "Server URL" : "Project URL"}
                    value={url}
                    onChangeText={setUrl}
                    placeholder={kind === "selfhost" ? "https://rock.example.com" : "https://xyz.supabase.co"}
                    keyboardType="url"
                    hint={
                      insecure ? (
                        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                          <Ionicons name="warning-outline" size={13} color={colors.warning} />
                          <Text style={{ fontSize: 12, color: colors.warning }}>
                            Unencrypted: use only on a network you trust.
                          </Text>
                        </View>
                      ) : null
                    }
                  />
                  {kind === "supabase" ? (
                    <Field label="Anon key" value={anonKey} onChangeText={setAnonKey} placeholder="eyJhbGciOi…" />
                  ) : null}

                  <View style={{ height: 1, backgroundColor: colors.border }} />

                  {mode === "signup" ? (
                    <Field label="Name" value={name} onChangeText={setName} placeholder="Your name" autoCapitalize="words" />
                  ) : null}
                  <Field
                    label="Email"
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    keyboardType="email-address"
                    autoComplete="email"
                  />
                  <Field
                    label="Password"
                    value={password}
                    onChangeText={setPassword}
                    placeholder="••••••••"
                    secureTextEntry
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  />

                  {errorBox}

                  {hadOtherAccount ? (
                    <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
                      <Ionicons name="information-circle-outline" size={14} color={colors.warning} style={{ marginTop: 1 }} />
                      <Text style={{ flex: 1, fontSize: 12, color: colors.warning, lineHeight: 17 }}>
                        If this is a different account than before, this device's data will be copied
                        into it (it may appear twice).
                      </Text>
                    </View>
                  ) : null}

                  <Button
                    label={mode === "signup" ? "Create account" : "Sign in"}
                    onPress={connect}
                    busy={busy === "connect"}
                  />
                  <TouchableOpacity
                    onPress={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(null); }}
                    hitSlop={8}
                    style={{ alignSelf: "center" }}
                  >
                    <Text style={{ fontSize: 13, color: colors.textSecondary }}>
                      {mode === "signup" ? "Already have an account? " : "New to this server? "}
                      <Text style={{ color: colors.primary, fontWeight: "600" }}>
                        {mode === "signup" ? "Sign in" : "Create account"}
                      </Text>
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {kind !== "off" ? (
                <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 17, paddingHorizontal: 4 }}>
                  {mode === "signup"
                    ? "Your habits on this device become the new account's data."
                    : "Your habits on this device merge into the account; the newest edit of each wins."}
                </Text>
              ) : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
