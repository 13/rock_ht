import {
  View,
  Text,
  TouchableOpacity,
  Linking,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { format, parseISO } from "date-fns";
import { useTheme } from "@/theme/theme-provider";
import { getBuildInfo } from "@/lib/build-info";
import { hapticLight } from "@/lib/haptics";
import { useAppUpdate, type AppUpdateState } from "@/hooks/use-app-update";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const CHANNEL_LABEL: Record<ReturnType<typeof getBuildInfo>["channel"], string> = {
  release: "release",
  dev: "dev",
  debug: "debug",
};

interface AboutRowProps {
  icon: IoniconName;
  label: string;
  value?: string;
  onPress?: () => void;
}

function AboutRow({ icon, label, value, onPress }: AboutRowProps) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      disabled={!onPress}
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
          backgroundColor: colors.primary + "20",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={17} color={colors.primary} />
      </View>
      <Text
        style={{
          flex: 1,
          fontSize: 15,
          color: colors.foreground,
          fontWeight: "500",
        }}
      >
        {label}
      </Text>
      {value && (
        <Text style={{ fontSize: 13, color: colors.textMuted }}>{value}</Text>
      )}
      {onPress && (
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      )}
    </TouchableOpacity>
  );
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const NOTES_PREVIEW_CHARS = 300;

function withHaptic(fn: () => void) {
  return () => {
    hapticLight();
    fn();
  };
}

interface PillButtonProps {
  label: string;
  onPress: () => void;
  variant?: "primary" | "text";
}

function PillButton({ label, onPress, variant = "primary" }: PillButtonProps) {
  const { colors } = useTheme();
  const primary = variant === "primary";
  return (
    <TouchableOpacity
      onPress={withHaptic(onPress)}
      activeOpacity={0.7}
      accessibilityRole="button"
      hitSlop={8}
      style={{
        paddingVertical: 7,
        paddingHorizontal: primary ? 14 : 4,
        borderRadius: 999,
        backgroundColor: primary ? colors.primary : "transparent",
      }}
    >
      <Text
        style={{
          fontSize: 14,
          fontWeight: "600",
          color: primary ? colors.onPrimary : colors.primary,
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function UpdateIcon({ name, color }: { name: IoniconName; color?: string }) {
  const { colors } = useTheme();
  const tint = color ?? colors.primary;
  return (
    <View
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        backgroundColor: tint + "20",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Ionicons name={name} size={17} color={tint} />
    </View>
  );
}

function UpdateRow() {
  const { colors } = useTheme();
  const { state, check, download, install, cancel } = useAppUpdate();

  const rowStyle = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
  };
  const titleStyle = { fontSize: 15, color: colors.foreground, fontWeight: "500" as const };
  const subStyle = { fontSize: 13, color: colors.textMuted, marginTop: 2 };

  const openRelease = (url: string) => () => {
    void Linking.openURL(url);
  };

  return renderState(state);

  function renderState(s: AppUpdateState) {
    switch (s.kind) {
      case "idle":
        return (
          <AboutRow
            icon="cloud-download-outline"
            label="Check for updates"
            onPress={withHaptic(() => void check())}
          />
        );
      case "checking":
        return (
          <View style={rowStyle} accessibilityLiveRegion="polite">
            <UpdateIcon name="cloud-download-outline" />
            <Text style={[titleStyle, { flex: 1 }]}>Checking…</Text>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        );
      case "up-to-date":
        return (
          <TouchableOpacity
            style={rowStyle}
            activeOpacity={0.7}
            onPress={withHaptic(() => void check())}
            accessibilityHint="Checks for updates again"
          >
            <UpdateIcon name="checkmark-circle-outline" />
            <View style={{ flex: 1 }}>
              <Text style={titleStyle}>You're on the latest version</Text>
              <Text style={subStyle}>Checked {format(s.checkedAt, "HH:mm")}</Text>
            </View>
            <Ionicons name="refresh" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        );
      case "available": {
        const notes = s.notes?.trim();
        const preview =
          notes && notes.length > NOTES_PREVIEW_CHARS
            ? notes.slice(0, NOTES_PREVIEW_CHARS).trimEnd() + "…"
            : notes;
        return (
          <View style={{ paddingVertical: 13, paddingHorizontal: 16, gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <UpdateIcon name="sparkles-outline" />
              <Text style={[titleStyle, { flex: 1 }]}>
                Version {s.version} available · {formatMb(s.sizeBytes)}
              </Text>
              <PillButton label="Download" onPress={() => void download()} />
            </View>
            {preview ? (
              <Text style={{ fontSize: 13, lineHeight: 19, color: colors.textSecondary, marginLeft: 44 }}>
                {preview}
              </Text>
            ) : null}
            <View style={{ marginLeft: 40 }}>
              <PillButton label="Release notes" variant="text" onPress={openRelease(s.releaseUrl)} />
            </View>
          </View>
        );
      }
      case "downloading": {
        const fraction = s.total > 0 ? Math.min(1, s.written / s.total) : 0;
        const percent = Math.floor(fraction * 100);
        return (
          <View style={rowStyle}>
            <UpdateIcon name="cloud-download-outline" />
            <View style={{ flex: 1, gap: 6 }}>
              <View
                style={{ height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" }}
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: percent }}
              >
                <View
                  style={{
                    height: 6,
                    width: `${fraction * 100}%`,
                    backgroundColor: colors.primary,
                  }}
                />
              </View>
              <Text style={{ fontSize: 13, color: colors.textMuted }}>
                {percent}% · {(s.written / (1024 * 1024)).toFixed(1)} / {formatMb(s.total)}
              </Text>
            </View>
            <PillButton label="Cancel" variant="text" onPress={() => void cancel()} />
          </View>
        );
      }
      case "ready":
        return (
          <View style={rowStyle}>
            <UpdateIcon name="checkmark-done-outline" />
            <View style={{ flex: 1 }}>
              <Text style={titleStyle}>Version {s.version} downloaded</Text>
              {s.verified ? (
                <Text style={subStyle}>Verified ✓</Text>
              ) : (
                <Text style={[subStyle, { color: colors.warning }]}>
                  Not verified — no checksum published
                </Text>
              )}
            </View>
            <PillButton label="Install" onPress={() => void install()} />
          </View>
        );
      case "error":
        return (
          <View style={{ paddingVertical: 13, paddingHorizontal: 16, gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <UpdateIcon name="alert-circle-outline" color={colors.danger} />
              <Text
                style={{ flex: 1, fontSize: 14, color: colors.danger, fontWeight: "500" }}
                accessibilityLiveRegion="polite"
              >
                {s.message}
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 16, marginLeft: 40 }}>
              <PillButton label="Try again" variant="text" onPress={() => void check()} />
              {s.releaseUrl ? (
                <PillButton
                  label="Open release page"
                  variant="text"
                  onPress={openRelease(s.releaseUrl)}
                />
              ) : null}
            </View>
          </View>
        );
    }
  }
}

function AboutDivider() {
  const { colors } = useTheme();
  return (
    <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 60 }} />
  );
}

export function AboutSection() {
  const { colors } = useTheme();
  const info = getBuildInfo();

  const builtLabel = info.buildDate
    ? format(parseISO(info.buildDate), "d MMM yyyy, HH:mm")
    : "Development build";

  const shaWithoutDirty = info.gitSha?.replace(/\+dirty$/, "");

  return (
    <>
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
        About
      </Text>
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
        <AboutRow
          icon="information-circle-outline"
          label="Version"
          value={info.versionName}
        />
        <AboutDivider />
        <AboutRow icon="layers-outline" label="Build" value={info.versionCode} />
        <AboutDivider />
        <AboutRow icon="calendar-outline" label="Built" value={builtLabel} />
        <AboutDivider />
        <AboutRow
          icon="git-commit-outline"
          label="Commit"
          value={info.gitSha ?? "—"}
          onPress={
            shaWithoutDirty
              ? () =>
                  Linking.openURL(
                    `https://github.com/${info.updateRepo}/commit/${shaWithoutDirty}`,
                  )
              : undefined
          }
        />
        <AboutDivider />
        <AboutRow
          icon="hammer-outline"
          label="Channel"
          value={CHANNEL_LABEL[info.channel]}
        />
        <AboutDivider />
        <AboutRow
          icon="logo-github"
          label="Source code"
          onPress={() => Linking.openURL(`https://github.com/${info.updateRepo}`)}
        />
        {Platform.OS === "android" && (
          <>
            <AboutDivider />
            <UpdateRow />
          </>
        )}
      </View>
    </>
  );
}
