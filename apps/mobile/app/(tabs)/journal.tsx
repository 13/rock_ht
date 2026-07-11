import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { format, parseISO } from "date-fns";
import { useJournal } from "@/hooks/use-journal";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { hapticMedium, hapticSuccess, hapticLight } from "@/lib/haptics";
import { MOOD_EMOJIS, MOOD_LABELS } from "@sisigo/types";
import type { CreateJournalEntryInput, JournalEntry } from "@sisigo/types";

const MOODS = [1, 2, 3, 4, 5] as const;

function MoodPicker({
  selected,
  onChange,
}: {
  selected: number | null;
  onChange: (mood: number | null) => void;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
      {MOODS.map((m) => (
        <TouchableOpacity
          key={m}
          onPress={() => {
            hapticLight();
            onChange(selected === m ? null : m);
          }}
          style={{
            flex: 1,
            alignItems: "center",
            paddingVertical: 10,
            borderRadius: 12,
            borderWidth: 1.5,
            borderColor: selected === m ? "#6366f1" : "#2d2d3a",
            backgroundColor: selected === m ? "#6366f115" : "transparent",
          }}
        >
          <Text style={{ fontSize: 20 }}>{MOOD_EMOJIS[m]}</Text>
          <Text
            style={{
              fontSize: 10,
              color: selected === m ? "#6366f1" : "#6b7280",
              marginTop: 3,
              fontWeight: "500",
            }}
          >
            {MOOD_LABELS[m]}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function EntryEditor({
  initial,
  onSubmit,
  onCancel,
  isLoading,
}: {
  initial?: JournalEntry;
  onSubmit: (input: CreateJournalEntryInput) => Promise<void>;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [content, setContent] = useState(initial?.content ?? "");
  const [mood, setMood] = useState<number | null>(initial?.mood ?? null);

  async function submit() {
    if (!content.trim()) return;
    await onSubmit({ content: content.trim(), mood });
  }

  return (
    <View style={{ padding: 20 }}>
      <MoodPicker selected={mood} onChange={setMood} />

      <TextInput
        value={content}
        onChangeText={setContent}
        placeholder="Write about your day, your progress, or anything on your mind..."
        placeholderTextColor="#4b5563"
        multiline
        numberOfLines={6}
        textAlignVertical="top"
        style={{
          backgroundColor: "#111118",
          color: "#f4f4f8",
          borderRadius: 12,
          padding: 14,
          fontSize: 15,
          lineHeight: 22,
          borderWidth: 1,
          borderColor: "#2d2d3a",
          minHeight: 130,
          marginBottom: 16,
        }}
        autoFocus
      />

      <View style={{ flexDirection: "row", gap: 12 }}>
        <TouchableOpacity
          onPress={onCancel}
          style={{
            flex: 1,
            paddingVertical: 13,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "#2d2d3a",
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#9ca3af", fontWeight: "600" }}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={submit}
          disabled={isLoading || !content.trim()}
          style={{
            flex: 1,
            paddingVertical: 13,
            borderRadius: 12,
            backgroundColor: content.trim() ? "#6366f1" : "#2d2d3a",
            alignItems: "center",
            opacity: isLoading ? 0.7 : 1,
          }}
        >
          {isLoading ? (
            <ActivityIndicator color="white" size="small" />
          ) : (
            <Text style={{ color: "white", fontWeight: "600" }}>
              {initial ? "Update" : "Save"}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function EntryCard({
  entry,
  onEdit,
  onDelete,
}: {
  entry: JournalEntry;
  onEdit: (e: JournalEntry) => void;
  onDelete: (id: string) => void;
}) {
  const formattedDate = format(parseISO(entry.entry_date), "EEE, MMM d");
  const moodEmoji = entry.mood ? MOOD_EMOJIS[entry.mood] : null;

  return (
    <TouchableOpacity
      onLongPress={() => {
        hapticMedium();
        Alert.alert("Journal Entry", "What would you like to do?", [
          { text: "Edit", onPress: () => onEdit(entry) },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => onDelete(entry.id),
          },
          { text: "Cancel", style: "cancel" },
        ]);
      }}
      activeOpacity={0.85}
      style={{
        backgroundColor: "#111118",
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: "#1e1e2a",
        marginBottom: 10,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <Text style={{ fontSize: 12, color: "#6b7280", fontWeight: "500" }}>
          {formattedDate}
        </Text>
        {moodEmoji && (
          <Text style={{ fontSize: 16 }}>{moodEmoji}</Text>
        )}
      </View>
      <Text
        style={{
          fontSize: 14,
          color: "#d1d5db",
          lineHeight: 20,
        }}
        numberOfLines={3}
      >
        {entry.content}
      </Text>
    </TouchableOpacity>
  );
}

export default function JournalScreen() {
  const { entries, isLoading, createEntry, updateEntry, deleteEntry, isCreating, isUpdating } =
    useJournal();

  const [showCreate, setShowCreate] = useState(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);

  async function handleCreate(input: CreateJournalEntryInput) {
    await createEntry(input);
    hapticSuccess();
    setShowCreate(false);
  }

  async function handleUpdate(input: CreateJournalEntryInput) {
    if (!editingEntry) return;
    await updateEntry({ id: editingEntry.id, content: input.content, mood: input.mood });
    hapticSuccess();
    setEditingEntry(null);
  }

  function confirmDelete(id: string) {
    Alert.alert("Delete Entry", "This journal entry will be permanently deleted.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteEntry(id),
      },
    ]);
  }

  // Group entries by month
  const grouped: [string, JournalEntry[]][] = [];
  const monthMap = new Map<string, JournalEntry[]>();
  for (const entry of entries) {
    const month = format(parseISO(entry.entry_date), "MMMM yyyy");
    if (!monthMap.has(month)) monthMap.set(month, []);
    monthMap.get(month)!.push(entry);
  }
  for (const [month, monthEntries] of monthMap) {
    grouped.push([month, monthEntries]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0a0a0f" }} edges={["top"]}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 20,
          paddingVertical: 16,
        }}
      >
        <Text style={{ fontSize: 26, fontWeight: "700", color: "#f4f4f8" }}>
          Journal
        </Text>
        <TouchableOpacity
          onPress={() => {
            hapticMedium();
            setShowCreate(true);
          }}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: "#6366f120",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: "#6366f1", fontSize: 22, lineHeight: 26 }}>+</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={{ padding: 20, gap: 10 }}>
          {[...Array(3)].map((_, i) => (
            <View
              key={i}
              style={{
                height: 90,
                backgroundColor: "#111118",
                borderRadius: 16,
                opacity: 0.6 - i * 0.1,
              }}
            />
          ))}
        </View>
      ) : entries.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 80 }}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>📔</Text>
          <Text style={{ fontSize: 18, fontWeight: "600", color: "#f4f4f8", marginBottom: 8 }}>
            Your journal is empty
          </Text>
          <Text style={{ fontSize: 14, color: "#6b7280", marginBottom: 24, textAlign: "center", paddingHorizontal: 40 }}>
            Reflect on your progress and track how you feel each day.
          </Text>
          <TouchableOpacity
            onPress={() => {
              hapticMedium();
              setShowCreate(true);
            }}
            style={{
              backgroundColor: "#6366f1",
              paddingHorizontal: 24,
              paddingVertical: 12,
              borderRadius: 24,
            }}
          >
            <Text style={{ color: "white", fontWeight: "600", fontSize: 15 }}>
              Write first entry
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
        >
          {grouped.map(([month, monthEntries]) => (
            <View key={month} style={{ marginBottom: 24 }}>
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "600",
                  color: "#6b7280",
                  textTransform: "uppercase",
                  letterSpacing: 0.8,
                  marginBottom: 10,
                }}
              >
                {month}
              </Text>
              {monthEntries.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  onEdit={setEditingEntry}
                  onDelete={confirmDelete}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      )}

      {/* FAB */}
      {entries.length > 0 && (
        <TouchableOpacity
          onPress={() => {
            hapticMedium();
            setShowCreate(true);
          }}
          style={{
            position: "absolute",
            right: 20,
            bottom: 32,
            width: 52,
            height: 52,
            borderRadius: 26,
            backgroundColor: "#6366f1",
            alignItems: "center",
            justifyContent: "center",
            shadowColor: "#6366f1",
            shadowOpacity: 0.5,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
            elevation: 8,
          }}
        >
          <Text style={{ color: "white", fontSize: 26, lineHeight: 30 }}>+</Text>
        </TouchableOpacity>
      )}

      {/* Create Sheet */}
      <BottomSheet
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        title="New entry"
        snapPoint={0.8}
      >
        <EntryEditor
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
          isLoading={isCreating}
        />
      </BottomSheet>

      {/* Edit Sheet */}
      <BottomSheet
        visible={!!editingEntry}
        onClose={() => setEditingEntry(null)}
        title="Edit entry"
        snapPoint={0.8}
      >
        {editingEntry && (
          <EntryEditor
            initial={editingEntry}
            onSubmit={handleUpdate}
            onCancel={() => setEditingEntry(null)}
            isLoading={isUpdating}
          />
        )}
      </BottomSheet>
    </SafeAreaView>
  );
}
