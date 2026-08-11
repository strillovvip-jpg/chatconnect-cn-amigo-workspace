import { useI18n } from "@/lib/i18n";

export function LanguageSelector({
  className = "",
}: {
  className?: string;
}) {
  const { preference, setPreference, messages } = useI18n();

  return (
    <label
      className={`flex items-center gap-2 text-xs text-white/70 ${className}`.trim()}
    >
      <span>{messages.app.languageLabel}</span>
      <select
        value={preference}
        onChange={(event) =>
          setPreference(
            event.target.value as "system" | "ja" | "zh-Hans" | "zh-Hant" | "en",
          )
        }
        className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white outline-none"
      >
        <option value="system">{messages.app.languageSystem}</option>
        <option value="ja">{messages.app.languageJa}</option>
        <option value="zh-Hans">{messages.app.languageZhHans}</option>
        <option value="zh-Hant">{messages.app.languageZhHant}</option>
        <option value="en">{messages.app.languageEn}</option>
      </select>
    </label>
  );
}
