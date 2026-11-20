/*
 * Fullscreen To Workspace — GNOME Shell extension.
 *
 * Only windows entering real fullscreen (F11) are moved to a separate
 * workspace; leaving fullscreen (or closing the window) switches the view
 * back to the original workspace. Titlebar maximize is left untouched.
 * Desktop/dock windows are excluded from workspace occupancy checks.
 *
 * Fork of "Maximize To Workspace With History" by AmanCode22
 * (https://github.com/AmanCode22/MaximizeWorkspaceHistory),
 * based on "MaximizeToWorkspace" by raonetwo.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 * Copyright (C) 2026 keltanas
 */
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const LOG_FILE = '/tmp/mwh.log';
const SETTLE_MS = 300;

function dbg(msg) {
    try {
        const stream = Gio.File.new_for_path(LOG_FILE).append_to(Gio.FileCreateFlags.NONE, null);
        stream.write_all(new TextEncoder().encode(`${new Date().toISOString()} ${msg}\n`), null);
        stream.close(null);
    } catch (e) {
        // ignore logging errors
    }
    console.log(`[MWH] ${msg}`);
}

function isAppWindow(w) {
    return w.window_type === Meta.WindowType.NORMAL &&
        w.get_layer() === Meta.StackLayer.NORMAL &&
        !w.is_always_on_all_workspaces();
}

dbg('module loaded');

export default class FullscreenToWorkspaceExtension extends Extension {
    constructor(args) {
        super(args);
        // window id -> {index, workspace} it was fullscreened from
        this._origin = new Map();
        this._timeouts = new Set();
        this._handles = [];
    }

    enable() {
        dbg('enable');
        this._mutterSettings = new Gio.Settings({ schema_id: 'org.gnome.mutter' });
        this._handles.push(global.window_manager.connect('size-change',
            (_wm, actor, change) => this._onSizeChange(actor, change)));
        this._handles.push(global.window_manager.connect('destroy',
            (_wm, actor) => this._onDestroy(actor)));
    }

    disable() {
        dbg('disable');
        this._mutterSettings = null;
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();
        for (const handle of this._handles.splice(0))
            global.window_manager.disconnect(handle);
        this._origin.clear();
    }

    _onSizeChange(actor, change) {
        // Only real fullscreen (F11 / xdg_toplevel.set_fullscreen).
        // Maximize/unmaximize from the titlebar button is ignored.
        if (change !== Meta.SizeChange.FULLSCREEN && change !== Meta.SizeChange.UNFULLSCREEN)
            return;

        const win = actor?.meta_window;
        if (!win || win.window_type !== Meta.WindowType.NORMAL)
            return;
        if (win.get_layer() === Meta.StackLayer.DESKTOP)
            return;
        if (win.is_always_on_all_workspaces())
            return;

        const name = change === Meta.SizeChange.FULLSCREEN ? 'FULLSCREEN' : 'UNFULLSCREEN';
        dbg(`event ${name} id=${win.get_id()} title="${win.get_title()}"`);

        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_MS, () => {
            this._timeouts.delete(timeoutId);
            this._check(win);
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(timeoutId);
    }

    _check(win) {
        try {
            if (!win.get_compositor_private())
                return;
            this._checkWindow(win);
        } catch (e) {
            dbg(`check failed: ${e}`);
        }
    }

    _checkWindow(win) {
        const id = win.get_id();
        const workspace = win.get_workspace();
        if (!workspace)
            return;

        const display = win.get_display();
        if (this._mutterSettings.get_boolean('workspaces-only-on-primary') &&
            win.get_monitor() !== display.get_primary_monitor()) {
            dbg(`skip id=${id}: window is not on the primary monitor`);
            return;
        }
        const manager = display.get_workspace_manager();
        const fullscreen = win.is_fullscreen();
        const others = workspace.list_windows().filter(w =>
            w !== win && isAppWindow(w) && w.get_monitor() === win.get_monitor());

        dbg(`check id=${id} fullscreen=${fullscreen} cur=${workspace.index()} others=${others.length} [${others.map(w => w.get_title()).join(' | ')}] origin=${this._origin.get(id)?.index} n=${manager.get_n_workspaces()} title="${win.get_title()}"`);

        if (fullscreen) {
            if (this._origin.has(id))
                return;

            // If there is nothing to separate from, the old workspace would
            // become empty and could be discarded by dynamic workspaces.
            if (others.length === 0) {
                dbg(`skip move id=${id}: no other app windows on workspace`);
                return;
            }

            let target = this._lastEmptyWorkspace(manager, win, workspace);
            if (!target) {
                try {
                    target = manager.append_new_workspace(false, global.get_current_time());
                } catch (e) {
                    dbg(`append workspace failed: ${e}`);
                }
            }
            if (!target) {
                dbg(`skip move id=${id}: no empty workspace`);
                return;
            }

            this._origin.set(id, { index: workspace.index(), workspace });
            this._move(win, target);
        } else {
            const origin = this._origin.get(id);
            if (!origin)
                return;
            this._origin.delete(id);

            const target = this._findWorkspace(manager, origin.workspace);
            if (target) {
                dbg(`return id=${id} -> ${origin.index}`);
                this._move(win, target);
            } else {
                dbg(`origin workspace ${origin.index} no longer exists`);
            }
        }
    }

    _lastEmptyWorkspace(manager, win, current) {
        let candidate = null;
        const n = manager.get_n_workspaces();
        const monitor = win.get_monitor();
        for (let i = 0; i < n; i++) {
            const workspace = manager.get_workspace_by_index(i);
            if (!workspace || workspace === current)
                continue;
            const count = workspace.list_windows()
                .filter(w => isAppWindow(w) && w.get_monitor() === monitor).length;
            if (count === 0)
                candidate = workspace;
        }
        return candidate;
    }

    _findWorkspace(manager, workspace) {
        if (!workspace)
            return null;
        const n = manager.get_n_workspaces();
        for (let i = 0; i < n; i++) {
            if (manager.get_workspace_by_index(i) === workspace)
                return workspace;
        }
        return null;
    }

    _move(win, workspace) {
        dbg(`move id=${win.get_id()} -> ${workspace.index()} title="${win.get_title()}"`);
        win.change_workspace(workspace);
        workspace.activate(global.get_current_time());
    }

    _onDestroy(actor) {
        const win = actor?.meta_window;
        if (!win)
            return;
        const id = win.get_id();
        const origin = this._origin.get(id);
        if (!origin)
            return;
        this._origin.delete(id);
        dbg(`destroy id=${id} origin=${origin.index}`);
        try {
            const manager = win.get_display().get_workspace_manager();
            const target = this._findWorkspace(manager, origin.workspace);
            if (target)
                target.activate(global.get_current_time());
        } catch (e) {
            dbg(`destroy failed: ${e}`);
        }
    }
}
