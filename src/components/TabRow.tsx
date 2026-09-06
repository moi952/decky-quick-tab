import React from "react";
import { DialogButton, Focusable } from "@decky/ui";
import { ActionButton, InlineConfirm } from "@moi952/decky-ui-kit";

// Same values @moi952/decky-ui-kit's own internal focusHighlight.ts uses
// for MediaRow's focus ring — duplicated here (that module isn't part of
// the package's public exports) rather than guessed at, so this row's
// focus highlight looks like every other one in this same panel.
const PANEL_BACKGROUND = "#35373c";
const HIGHLIGHT_COLOR = "#dcdedf";
const HIGHLIGHT_BACKGROUND = "#2a3a4a";
const ROUNDNESS = "var(--round-radius-size, 4px)";

let rowIdCounter = 0;

export interface TabRowAction {
  key: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "bordered" | "danger";
  // When set, clicking this action shows an InlineConfirm below the
  // actions row instead of running `onClick` right away — only a
  // confirmed Delete actually calls it.
  confirm?: { description: React.ReactNode; confirmLabel?: React.ReactNode; cancelLabel?: React.ReactNode };
}

interface TabRowProps {
  media: React.ReactNode;
  title: React.ReactNode;
  actions: TabRowAction[];
  // The Y-button shortcut runs this action the same way clicking it would
  // — including going through its own `confirm` step if it has one — not
  // a separate bypass callback, so Y can never skip a delete confirmation.
  optionsActionKey?: string;
  onOptionsActionDescription?: React.ReactNode;
  // Set as a data attribute on the row's own container so an external
  // caller (the list rendering this row) can find and focus this specific
  // instance's header after it's just been added — e.g. pinning a plugin
  // should send focus straight to its own new row.
  rowKey?: string;
}

// Collapsed by default; only the currently-focused row expands, and
// landing on it (arriving from the row above/below via D-pad, no A press)
// puts focus directly on its first button — no intermediate "press A to
// enter" step. The header (icon+title) is a real, always-present
// DialogButton: it's what D-pad navigation actually lands on while
// collapsed.
//
// DialogButton doesn't accept onFocus/onBlur as props (it's not in
// DialogButtonProps) — but real DOM focus/blur still bubbles up through
// plain ancestor elements regardless of that, same as any native
// `focusin`/`focusout`, so both are handled on the *container* div
// instead: onFocus expands + hands focus to the first button, but only
// when the header itself is what got focused (checked against headerRef)
// — otherwise it would also fire (redundantly, but not harmlessly: it
// would steal focus back) every time navigation moves between the action
// buttons themselves. onBlur collapses, but only once focus has left the
// container entirely (checked against relatedTarget) — moving from the
// header into this same row's own buttons must not count as leaving it,
// which is what collapsed (and unmounted) the very thing being navigated
// into in an earlier attempt.
export const TabRow: React.FC<TabRowProps> = ({
  media,
  title,
  actions,
  optionsActionKey,
  onOptionsActionDescription,
  rowKey,
}) => {
  const [expanded, setExpanded] = React.useState(false);
  const [confirmingKey, setConfirmingKey] = React.useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const headerRef = React.useRef<HTMLDivElement>(null);
  const actionsRef = React.useRef<HTMLDivElement>(null);
  const confirmRef = React.useRef<HTMLDivElement>(null);
  const [cls] = React.useState(() => `qt-tab-row-${++rowIdCounter}`);

  const focusFirstAction = () => {
    // The buttons only exist in the DOM once `expanded` renders — a rAF
    // gives React one paint cycle before grabbing one.
    requestAnimationFrame(() => {
      actionsRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    });
  };

  // After reordering, the just-clicked chevron can become the new edge
  // (e.g. pressing "down" moves this row to the bottom, disabling that
  // same "down" button) — a disabled element can't hold focus, and the
  // browser drops it with nowhere to go. This puts focus back on the same
  // button index that was clicked whenever it's still enabled (so "down"
  // stays on "down", matching "up" staying on "up"), only falling back to
  // the first enabled one if that specific button is now gone/disabled.
  const runAction = (onClick: () => void, index: number) => {
    onClick();
    requestAnimationFrame(() => {
      const buttons = actionsRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [];
      const same = buttons[index];
      const target = same && !same.disabled ? same : Array.from(buttons).find((b) => !b.disabled);
      target?.focus();
    });
  };

  const handleActionClick = (a: TabRowAction, index: number) => {
    if (a.confirm) {
      setConfirmingKey(a.key);
      // A single rAF left Steam's own gamepad focus-ring one frame behind
      // the real DOM focus (the button worked, but looked unfocused until
      // the first stick nudge) — a second one gives its overlay an extra
      // frame to catch up before anything can move away again.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          confirmRef.current?.querySelector<HTMLElement>("button")?.focus();
        });
      });
      return;
    }
    runAction(a.onClick, index);
  };

  const confirming = confirmingKey ? actions.find((a) => a.key === confirmingKey) : undefined;

  return (
    <div
      ref={containerRef}
      className={cls}
      data-row-key={rowKey}
      style={{
        width: "100%",
        boxSizing: "border-box",
        borderRadius: ROUNDNESS,
        overflow: "hidden",
        background: PANEL_BACKGROUND,
        border: "2px solid transparent",
        marginBottom: 4,
      }}
      onFocus={(e) => {
        if (headerRef.current?.contains(e.target as Node)) {
          setExpanded(true);
          focusFirstAction();
        }
      }}
      onBlur={(e) => {
        if (!containerRef.current?.contains(e.relatedTarget as Node | null)) {
          setExpanded(false);
          setConfirmingKey(null);
        }
      }}
    >
      <style>{`
        .${cls}:focus-within, .${cls}:hover {
          background: ${HIGHLIGHT_BACKGROUND} !important;
          border-color: ${HIGHLIGHT_COLOR} !important;
        }
      `}</style>
      {expanded ? (
        // Plain, non-focusable once expanded: with the header still a
        // real nav stop here, pressing up from the first action button
        // landed back on it instead of escaping to the row above — an
        // extra, dead-end hop within this same row. Swapping it out for a
        // plain div (same look, no ActionButton to catch) removes it from
        // the nav graph entirely while expanded, so "up" from the actions
        // goes straight to whatever's above this row instead.
        <div
          ref={headerRef}
          style={{ width: "100%", boxSizing: "border-box", display: "flex", alignItems: "center", gap: 10, padding: "4px 8px" }}
        >
          {media}
          <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>{title}</div>
        </div>
      ) : (
        <DialogButton
          ref={headerRef}
          // A no-op — DialogButton needs a real interaction handler to
          // register as an actual nav stop at all; there's nothing for a
          // press here to actually do since focus alone already expands
          // the row and hands off to the first button.
          onClick={() => undefined}
          style={{
            width: "100%",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "4px 8px",
            background: "transparent",
            border: "none",
          }}
        >
          {media}
          <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>{title}</div>
        </DialogButton>
      )}

      {expanded && !confirming?.confirm && (
        <Focusable
          ref={actionsRef}
          flow-children="horizontal"
          style={{ display: "flex", gap: 8, width: "100%", boxSizing: "border-box", padding: "0 8px 6px" }}
        >
          {actions.map((a, i) => (
            <ActionButton
              key={a.key}
              size="small"
              variant={a.variant ?? "bordered"}
              disabled={a.disabled}
              onOptionsButton={
                optionsActionKey
                  ? () => {
                      const idx = actions.findIndex((x) => x.key === optionsActionKey);
                      if (idx >= 0) handleActionClick(actions[idx], idx);
                    }
                  : undefined
              }
              onOptionsActionDescription={onOptionsActionDescription}
              onClick={() => handleActionClick(a, i)}
            >
              {a.icon}
            </ActionButton>
          ))}
        </Focusable>
      )}

      {expanded && confirming?.confirm && (
        // Swallowing up/down here is a best-effort attempt (untested) at
        // stopping D-pad navigation from leaving this row while a delete
        // is pending confirmation — Steam's own nav system decides
        // "what's next" on its own, so this may or may not actually work.
        <Focusable
          ref={confirmRef}
          onGamepadDirection={(e) => {
            if (e.detail.button === 9 || e.detail.button === 10) {
              e.stopPropagation();
            }
          }}
          style={{ width: "100%", boxSizing: "border-box", padding: "0 8px 8px" }}
        >
          <InlineConfirm
            description={confirming.confirm.description}
            confirmLabel={confirming.confirm.confirmLabel ?? "Delete"}
            cancelLabel={confirming.confirm.cancelLabel ?? "Cancel"}
            onCancel={() => {
              setConfirmingKey(null);
              focusFirstAction();
            }}
            onConfirm={() => {
              confirming.onClick();
              setConfirmingKey(null);
            }}
          />
        </Focusable>
      )}
    </div>
  );
};
