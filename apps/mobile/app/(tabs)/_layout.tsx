import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/theme-provider";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const TABS: {
  name: string;
  title: string;
  icon: IoniconName;
  activeIcon: IoniconName;
}[] = [
  { name: "index", title: "Today", icon: "today-outline", activeIcon: "today" },
  { name: "habits", title: "Habits", icon: "list-outline", activeIcon: "list" },
  { name: "analytics", title: "Stats", icon: "bar-chart-outline", activeIcon: "bar-chart" },
  { name: "journal", title: "Journal", icon: "book-outline", activeIcon: "book" },
  { name: "settings", title: "Settings", icon: "settings-outline", activeIcon: "settings" },
];

export default function TabsLayout() {
  // Android draws edge-to-edge, so the bar must clear the system navigation
  // bar (and the iOS home indicator) itself
  const { bottom } = useSafeAreaInsets();
  const bottomPadding = Math.max(bottom, 8);
  const { colors } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          paddingBottom: bottomPadding,
          paddingTop: 6,
          // 54dp of content: the icon slot takes ~35dp, the label ~16dp
          height: 60 + bottomPadding,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "500",
          marginTop: 2,
        },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons
                name={focused ? tab.activeIcon : tab.icon}
                size={size}
                color={color}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
