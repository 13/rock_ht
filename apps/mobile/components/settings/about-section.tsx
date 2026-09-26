import { View, Text, TouchableOpacity, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { format, parseISO } from "date-fns";
import { useTheme } from "@/theme/theme-provider";
import { getBuildInfo } from "@/lib/build-info";

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
      </View>
    </>
  );
}
