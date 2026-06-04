import { useCallback, useEffect, useState } from "react";
import { Button } from "../../ui/Button";
import { Select } from "../../ui/Select";
import { apiFetch } from "../../../lib/api";
import { emitWorkspaceLayoutUpdated } from "../../../lib/pageLayoutEvents";

export function NotificationsLayoutPanel() {
  const [loading, setLoading] = useState(true);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [notificationSettings, setNotificationSettings] = useState({
    dueSoonThreshold: "3",
    reminderOffsets: [7, 3, 1, 0] as number[],
  });
  const [displayTimezone, setDisplayTimezone] = useState("UTC");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{
        notifications?: { dueSoonThreshold?: string };
        reminderOffsets?: number[];
        displayTimezone?: string;
      }>("/settings");
      if (res.notifications) {
        setNotificationSettings({
          dueSoonThreshold: res.notifications.dueSoonThreshold ?? "3",
          reminderOffsets:
            Array.isArray(res.reminderOffsets) && res.reminderOffsets.length
              ? res.reminderOffsets
              : [7, 3, 1, 0],
        });
      }
      if (res.displayTimezone) setDisplayTimezone(res.displayTimezone);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setSaveMsg(null);
    try {
      await apiFetch("/settings", {
        method: "PATCH",
        body: JSON.stringify({
          notifications: {
            dueSoonThreshold: notificationSettings.dueSoonThreshold,
          },
          reminderOffsets: notificationSettings.reminderOffsets,
          displayTimezone,
        }),
      });
      setSaveMsg("Notification settings saved for this workspace.");
      emitWorkspaceLayoutUpdated({ page: "notifications" });
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed");
    }
  };

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">Loading notification settings…</p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium mb-2">Reminder offsets (days before due)</p>
        <div className="space-y-2">
          {[0, 1, 2, 3, 5, 7, 14, 30].map((days) => {
            const checked = notificationSettings.reminderOffsets.includes(days);
            return (
              <label key={days} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    setNotificationSettings((prev) => {
                      const next = new Set(prev.reminderOffsets);
                      if (checked) next.delete(days);
                      else next.add(days);
                      return {
                        ...prev,
                        reminderOffsets: [...next].sort((a, b) => b - a),
                      };
                    });
                  }}
                />
                {days === 0 ? "Due today" : `${days} day${days === 1 ? "" : "s"} before`}
              </label>
            );
          })}
        </div>
      </div>

      <Select
        label="Legacy single threshold (fallback)"
        value={notificationSettings.dueSoonThreshold}
        onChange={(e) =>
          setNotificationSettings((prev) => ({
            ...prev,
            dueSoonThreshold: e.target.value,
          }))
        }
        options={[
          { value: "1", label: "1 day" },
          { value: "2", label: "2 days" },
          { value: "3", label: "3 days" },
          { value: "5", label: "5 days" },
          { value: "7", label: "7 days" },
        ]}
      />

      <Select
        label="Display timezone (audit trail)"
        value={displayTimezone}
        onChange={(e) => setDisplayTimezone(e.target.value)}
        options={[
          { value: "UTC", label: "UTC" },
          { value: "America/New_York", label: "America/New York" },
          { value: "America/Chicago", label: "America/Chicago" },
          { value: "America/Denver", label: "America/Denver" },
          { value: "America/Los_Angeles", label: "America/Los Angeles" },
          { value: "Europe/London", label: "Europe/London" },
          { value: "Europe/Paris", label: "Europe/Paris" },
          { value: "Asia/Kolkata", label: "Asia/Kolkata (IST)" },
          { value: "Asia/Singapore", label: "Asia/Singapore" },
          { value: "Australia/Sydney", label: "Australia/Sydney" },
        ]}
      />

      <div className="flex items-center justify-between gap-2">
        {saveMsg ? <p className="text-sm text-muted-foreground">{saveMsg}</p> : <span />}
        <Button type="button" onClick={() => void handleSave()}>
          Save notification settings
        </Button>
      </div>
    </div>
  );
}
