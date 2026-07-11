import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Platform } from "react-native";

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
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#6366f1",
        tabBarInactiveTintColor: "#6b6b80",
        tabBarStyle: {
          backgroundColor: "#111118",
          borderTopColor: "#1e1e2a",
          borderTopWidth: 1,
          paddingBottom: Platform.OS === "ios" ? 20 : 8,
          paddingTop: 8,
          height: Platform.OS === "ios" ? 82 : 62,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "500",
          marginTop: 2,
        },
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
