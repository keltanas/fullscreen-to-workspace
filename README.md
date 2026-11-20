# Fullscreen To Workspace

GNOME Shell extension that moves a window to a separate workspace when it
enters **fullscreen** (F11) and brings it back to the original workspace when
it leaves fullscreen — or when the fullscreen window is closed.

Maximizing with the titlebar button, double-click on the header bar or
`Super+Up` is intentionally **not** affected: only real fullscreen transitions
(`Meta.SizeChange.FULLSCREEN` / `UNFULLSCREEN`) trigger the move.

## Requirements

- GNOME Shell 45–50 (tested on GNOME 46 / Ubuntu 24.04, Wayland)
- Dynamic workspaces enabled (`org.gnome.mutter dynamic-workspaces true`,
  the default)

## Install

```bash
git clone https://github.com/keltanas/fullscreen-to-workspace.git \
  ~/.local/share/gnome-shell/extensions/fullscreen-to-workspace@keltanas
gnome-extensions enable fullscreen-to-workspace@keltanas
```

Log out and back in afterwards — on Wayland a session restart is required for
GNOME Shell to pick up new or changed extension code.

## Behavior details

- Only windows on the primary monitor are moved (when
  `workspaces-only-on-primary` is enabled).
- The window is moved only if other application windows share its workspace;
  desktop and dock windows (e.g. Desktop Icons NG) do not count.
- The original workspace is tracked as an object, so the return keeps working
  even when dynamic workspaces reindex.
- Closing a fullscreen window returns the view to the original workspace.
- Debug log: `/tmp/mwh.log`

## Credits

Fork of [Maximize To Workspace With History](https://github.com/AmanCode22/MaximizeWorkspaceHistory)
by AmanCode22, based on MaximizeToWorkspace by raonetwo.

## License

GPL-2.0-or-later, see [LICENSE](LICENSE).
