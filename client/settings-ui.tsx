import { Children, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { OptionList, type PickerOption } from "./picker";
import { Label, SwitchTrack, font, noFocusRing, radius, space, touch, useTheme } from "./ui";
import { t } from "../shared/i18n";

/** A settings page: its title and one line on what it is for, then groups. */
export function SettingsPage({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <View style={{ gap: space[5] }}>
      <View style={{ gap: space[1] }}>
        <Label bold size={font.xl} selectable={false}>
          {title}
        </Label>
        {!!description && (
          <Label muted size={font.md}>
            {description}
          </Label>
        )}
      </View>
      {children}
    </View>
  );
}

/** A titled card of rows separated by hairlines. */
export function SettingsGroup({ title, description, children }: { title?: string; description?: string; children: ReactNode }) {
  const { colors } = useTheme();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={{ gap: space[2] }}>
      {(!!title || !!description) && (
        <View style={{ gap: 2, paddingHorizontal: space[1] }}>
          {!!title && (
            <Label bold size={font.base} selectable={false}>
              {title}
            </Label>
          )}
          {!!description && (
            <Label muted size={font.sm}>
              {description}
            </Label>
          )}
        </View>
      )}
      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface1, overflow: "hidden" }}>
        {rows.map((row, index) => (
          <View key={index} style={{ borderTopWidth: index ? 1 : 0, borderTopColor: colors.border }}>
            {row}
          </View>
        ))}
      </View>
    </View>
  );
}

/** One setting: its name and what it does on the left, the control on the right. */
export function SettingRow({
  title,
  detail,
  leading,
  trailing,
  onPress,
  disabled = false,
  role = "button",
  state,
}: {
  title: string;
  detail?: string;
  /** An icon before the title, e.g. a service logo. */
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?(): void;
  disabled?: boolean;
  role?: "button" | "switch";
  state?: { checked?: boolean; expanded?: boolean };
}) {
  const { colors } = useTheme();
  const [hovered, setHovered] = useState(false);
  const body = (
    <>
      {leading}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Label size={font.base} selectable={false}>
          {title}
        </Label>
        {!!detail && (
          <Label muted size={font.sm} selectable={false}>
            {detail}
          </Label>
        )}
      </View>
      {trailing}
    </>
  );
  const style = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: space[4],
    minHeight: touch ? 56 : 52,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
  };
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={title}
      accessibilityState={{ disabled, ...state }}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={{ ...noFocusRing, ...style, opacity: disabled ? 0.5 : 1, backgroundColor: hovered && !disabled ? colors.surface2 : "transparent" }}
    >
      {body}
    </Pressable>
  );
}

/** A row that switches something on or off. */
export function SettingSwitch({ title, detail, value, onChange, disabled = false }: { title: string; detail?: string; value: boolean; onChange(value: boolean): void; disabled?: boolean }) {
  return <SettingRow title={title} detail={detail} role="switch" disabled={disabled} state={{ checked: value }} onPress={() => onChange(!value)} trailing={<SwitchTrack value={value} />} />;
}

/** A row that shows its value and opens the choices under it. */
export function SettingSelect({
  title,
  detail,
  value,
  options,
  placeholder,
  onChange,
  loading = false,
  disabled = false,
}: {
  title: string;
  detail?: string;
  value: string;
  options: readonly PickerOption[];
  placeholder: string;
  onChange(value: string): void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <View>
      <SettingRow
        title={title}
        detail={detail}
        disabled={disabled}
        state={{ expanded: open }}
        onPress={() => setOpen(!open)}
        trailing={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5], maxWidth: "55%" }}>
            <View style={{ flexShrink: 1, minWidth: 0 }}>
              <Label medium={!!selected} muted={!selected} size={font.base} lines={1} selectable={false}>
                {loading ? t("Loading…") : selected?.label || placeholder}
              </Label>
            </View>
            <Icon name={open ? "ChevronUp" : "ChevronDown"} size={15} color={colors.foregroundMuted} />
          </View>
        }
      />
      <OptionList
        open={open}
        title={title}
        options={options}
        value={value}
        onChange={(next) => {
          setOpen(false);
          onChange(next);
        }}
      />
    </View>
  );
}
