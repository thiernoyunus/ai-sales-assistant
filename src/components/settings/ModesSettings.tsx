/**
 * ModesSettings — the sales-mode configuration panel.
 *
 * Previously re-exported from the private premium/ submodule, which is not
 * part of this checkout — this app has no paid tier, so that panel rendered
 * nothing. This is a first-party replacement wired to the same modes:* IPC
 * surface (mode CRUD, custom context, reference files, note sections) that
 * already existed and already worked; only the UI was missing.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus, Trash2, FileText, Upload, Check, Loader2, Pencil, AlertCircle } from 'lucide-react';
import { useT } from '../../i18n';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';

interface ModeSummary {
    id: string;
    name: string;
    templateType: string;
    customContext: string;
    isActive: boolean;
    createdAt: string;
    referenceFileCount: number;
}

interface ReferenceFile {
    id: string;
    modeId: string;
    fileName: string;
    content: string;
    createdAt: string;
}

interface NoteSection {
    id: string;
    modeId: string;
    title: string;
    description: string;
    sortOrder: number;
}

interface FileStatus {
    fileId: string;
    fileName: string;
    status: string;
    chunkCount: number;
}

interface ModesSettingsProps {
    onClose: () => void;
    isPremium?: boolean;
    isLoaded?: boolean;
    isTrialActive?: boolean;
    onOpenNativelyAPI?: () => void;
}

const TEMPLATE_LABEL: Record<string, string> = { general: 'General', sales: 'Sales' };
const CUSTOM_CONTEXT_MAX = 8000;

const ModesSettings: React.FC<ModesSettingsProps> = ({ onClose }) => {
    const t = useT();
    const isLight = useResolvedTheme() === 'light';

    const [modes, setModes] = useState<ModeSummary[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [newType, setNewType] = useState<'general' | 'sales'>('sales');

    const [nameDraft, setNameDraft] = useState('');
    const [contextDraft, setContextDraft] = useState('');
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
    const saveTimerRef = useRef<number | null>(null);
    const skipNextAutosaveRef = useRef(false);

    const [files, setFiles] = useState<ReferenceFile[]>([]);
    const [fileStatuses, setFileStatuses] = useState<Record<string, FileStatus>>({});
    const [uploading, setUploading] = useState(false);

    const [sections, setSections] = useState<NoteSection[]>([]);
    const [addingSection, setAddingSection] = useState(false);
    const [sectionTitle, setSectionTitle] = useState('');
    const [sectionDesc, setSectionDesc] = useState('');

    const selected = useMemo(() => modes.find((m) => m.id === selectedId) || null, [modes, selectedId]);

    const refreshFileStatuses = async (modeId: string) => {
        try {
            const r = await window.electronAPI.modesGetReferenceFileStatus(modeId);
            if (r.success && r.statuses) {
                const map: Record<string, FileStatus> = {};
                r.statuses.forEach((s) => { map[s.fileId] = s; });
                setFileStatuses(map);
            }
        } catch { /* status is a nice-to-have, never block on it */ }
    };

    const loadModes = async (preferId?: string) => {
        const all = await window.electronAPI.modesGetAll();
        setModes(all);
        const next = preferId && all.some((m) => m.id === preferId)
            ? preferId
            : (all.find((m) => m.isActive)?.id ?? all[0]?.id ?? null);
        setSelectedId(next);
    };

    useEffect(() => {
        setLoading(true);
        loadModes().catch(() => setError('Could not load modes.')).finally(() => setLoading(false));
    }, []);

    // Load per-mode detail whenever the selection changes.
    useEffect(() => {
        if (!selected) {
            setFiles([]); setSections([]); setFileStatuses({});
            return;
        }
        skipNextAutosaveRef.current = true;
        setNameDraft(selected.name);
        setContextDraft(selected.customContext || '');
        window.electronAPI.modesGetReferenceFiles(selected.id).then(setFiles).catch(() => setFiles([]));
        window.electronAPI.modesGetNoteSections(selected.id).then(setSections).catch(() => setSections([]));
        refreshFileStatuses(selected.id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId]);

    // Live indexing status while a battlecard/reference file is being ingested.
    useEffect(() => {
        const off = window.electronAPI.onModeFileIndexStatus?.(({ modeId }) => {
            if (modeId === selectedId) refreshFileStatuses(modeId);
        });
        return () => { off?.(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId]);

    // Debounced autosave for name + custom context — the two fields the
    // sales-mode marketing page describes as the Pro-tier "custom context"
    // configuration (up to ~8,000 characters, plus reference files below).
    useEffect(() => {
        if (!selected) return;
        if (skipNextAutosaveRef.current) { skipNextAutosaveRef.current = false; return; }
        if (nameDraft === selected.name && contextDraft === (selected.customContext || '')) return;

        setSaveState('saving');
        if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = window.setTimeout(async () => {
            const id = selected.id;
            const trimmedName = nameDraft.trim() || selected.name;
            try {
                const res = await window.electronAPI.modesUpdate(id, { name: trimmedName, customContext: contextDraft });
                if (res.success) {
                    setModes((prev) => prev.map((m) => (m.id === id ? { ...m, name: trimmedName, customContext: contextDraft } : m)));
                    setSaveState('saved');
                    window.setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1500);
                } else {
                    setSaveState('idle');
                    setError(res.error || 'Could not save changes.');
                }
            } catch {
                setSaveState('idle');
                setError('Could not save changes.');
            }
        }, 600);
        return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nameDraft, contextDraft]);

    const handleCreate = async () => {
        if (!newName.trim()) return;
        try {
            const res = await window.electronAPI.modesCreate({ name: newName.trim(), templateType: newType });
            if (res.success && res.mode) {
                await loadModes(res.mode.id);
                setCreating(false);
                setNewName('');
            } else {
                setError(res.error || 'Could not create the mode.');
            }
        } catch {
            setError('Could not create the mode.');
        }
    };

    const handleDelete = async (id: string) => {
        if (modes.length <= 1) { setError('You need at least one mode.'); return; }
        if (!window.confirm('Delete this mode? Its reference files and note sections go with it.')) return;
        try {
            const res = await window.electronAPI.modesDelete(id);
            if (res.success) {
                await loadModes();
            } else {
                setError(res.error || 'Could not delete the mode.');
            }
        } catch {
            setError('Could not delete the mode.');
        }
    };

    const handleSetActive = async (id: string) => {
        try {
            const res = await window.electronAPI.modesSetActive(id);
            if (res.success) {
                setModes((prev) => prev.map((m) => ({ ...m, isActive: m.id === id })));
            } else {
                setError(res.error || 'Could not activate the mode.');
            }
        } catch {
            setError('Could not activate the mode.');
        }
    };

    const handleUploadFile = async () => {
        if (!selected) return;
        setUploading(true);
        setError(null);
        try {
            const res = await window.electronAPI.modesUploadReferenceFile(selected.id);
            if (res.success) {
                const list = await window.electronAPI.modesGetReferenceFiles(selected.id);
                setFiles(list);
                setModes((prev) => prev.map((m) => (m.id === selected.id ? { ...m, referenceFileCount: list.length } : m)));
                refreshFileStatuses(selected.id);
            } else if (!res.cancelled) {
                setError(res.error || 'Could not add that file.');
            }
        } catch {
            setError('Could not add that file.');
        } finally {
            setUploading(false);
        }
    };

    const handleDeleteFile = async (fileId: string) => {
        if (!selected) return;
        try {
            const res = await window.electronAPI.modesDeleteReferenceFile(fileId);
            if (res.success) {
                const list = await window.electronAPI.modesGetReferenceFiles(selected.id);
                setFiles(list);
                setModes((prev) => prev.map((m) => (m.id === selected.id ? { ...m, referenceFileCount: list.length } : m)));
            } else {
                setError(res.error || 'Could not remove that file.');
            }
        } catch {
            setError('Could not remove that file.');
        }
    };

    const handleAddSection = async () => {
        if (!selected || !sectionTitle.trim()) return;
        try {
            const res = await window.electronAPI.modesAddNoteSection(selected.id, sectionTitle.trim(), sectionDesc.trim());
            if (res.success) {
                const list = await window.electronAPI.modesGetNoteSections(selected.id);
                setSections(list);
                setSectionTitle('');
                setSectionDesc('');
                setAddingSection(false);
            } else {
                setError(res.error || 'Could not add that section.');
            }
        } catch {
            setError('Could not add that section.');
        }
    };

    const handleDeleteSection = async (id: string) => {
        try {
            const res = await window.electronAPI.modesDeleteNoteSection(id);
            if (res.success) setSections((prev) => prev.filter((s) => s.id !== id));
        } catch { /* non-fatal */ }
    };

    const cardClass = `rounded-xl border border-border-subtle bg-bg-item-surface`;

    return (
        <div className="h-full w-full flex flex-col text-text-primary">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle shrink-0">
                <h2 className="text-sm font-bold">{t('Modes')}</h2>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={t('Close')}
                    className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-item-active transition-colors"
                >
                    <X size={16} />
                </button>
            </div>

            {error && (
                <div className="mx-5 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs shrink-0">
                    <AlertCircle size={14} className="shrink-0" />
                    <span className="flex-1">{error}</span>
                    <button type="button" onClick={() => setError(null)} aria-label={t('Dismiss error')} className="text-red-400/70 hover:text-red-400">
                        <X size={12} />
                    </button>
                </div>
            )}

            {loading ? (
                <div className="flex-1 flex items-center justify-center text-text-tertiary text-xs gap-2">
                    <Loader2 size={14} className="animate-spin" /> {t('Loading modes...')}
                </div>
            ) : (
                <div className="flex-1 flex min-h-0">
                    {/* Sidebar: mode list */}
                    <div className="w-[220px] border-r border-border-subtle flex flex-col shrink-0">
                        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
                            {modes.map((mode) => (
                                <button
                                    type="button"
                                    key={mode.id}
                                    onClick={() => setSelectedId(mode.id)}
                                    aria-label={`${t('Select mode')}: ${mode.name}`}
                                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                                        mode.id === selectedId ? 'bg-bg-item-active' : 'hover:bg-bg-item-active/60'
                                    }`}
                                >
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-xs font-medium truncate">{mode.name}</span>
                                        {mode.isActive && (
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title={t('Active mode')} />
                                        )}
                                    </div>
                                    <div className="text-[10px] text-text-tertiary mt-0.5">
                                        {TEMPLATE_LABEL[mode.templateType] || mode.templateType}
                                        {mode.referenceFileCount > 0 && ` · ${mode.referenceFileCount} file${mode.referenceFileCount === 1 ? '' : 's'}`}
                                    </div>
                                </button>
                            ))}
                        </div>
                        <div className="p-2 border-t border-border-subtle">
                            {creating ? (
                                <div className="space-y-1.5 p-1">
                                    <input
                                        autoFocus
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
                                        placeholder={t('Mode name')}
                                        className="w-full text-xs px-2 py-1.5 rounded-md bg-bg-input border border-border-subtle text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary"
                                    />
                                    <select
                                        value={newType}
                                        aria-label={t('New mode template')}
                                        onChange={(e) => setNewType(e.target.value as 'general' | 'sales')}
                                        className="w-full text-xs px-2 py-1.5 rounded-md bg-bg-input border border-border-subtle text-text-primary focus:outline-none"
                                    >
                                        <option value="sales">{t('Sales')}</option>
                                        <option value="general">{t('General')}</option>
                                    </select>
                                    <div className="flex gap-1.5">
                                        <button
                                            type="button"
                                            onClick={handleCreate}
                                            disabled={!newName.trim()}
                                            className="flex-1 text-xs font-medium py-1.5 rounded-md bg-accent-primary text-white disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            {t('Create')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => { setCreating(false); setNewName(''); }}
                                            className="px-2 text-xs text-text-tertiary hover:text-text-primary"
                                        >
                                            {t('Cancel')}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setCreating(true)}
                                    className="w-full flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-item-active transition-colors"
                                >
                                    <Plus size={13} /> {t('New mode')}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Main: selected mode detail */}
                    {selected ? (
                        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                            {/* Name + active toggle */}
                            <div className="flex items-center gap-2">
                                <div className="flex-1 flex items-center gap-2">
                                    <Pencil size={12} className="text-text-tertiary shrink-0" />
                                    <input
                                        value={nameDraft}
                                        aria-label={t('Mode name')}
                                        onChange={(e) => setNameDraft(e.target.value)}
                                        className="flex-1 text-sm font-semibold bg-transparent focus:outline-none border-b border-transparent focus:border-border-muted pb-0.5"
                                    />
                                </div>
                                {selected.isActive ? (
                                    <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-500 shrink-0">
                                        {t('Active')}
                                    </span>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => handleSetActive(selected.id)}
                                        className="text-[10px] font-medium px-2.5 py-1 rounded-full border border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-muted transition-colors shrink-0"
                                    >
                                        {t('Set active')}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => handleDelete(selected.id)}
                                    className="p-1.5 rounded-lg text-text-tertiary hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                                    title={t('Delete mode')}
                                    aria-label={t('Delete mode')}
                                >
                                    <Trash2 size={13} />
                                </button>
                            </div>

                            {/* Custom context */}
                            <div className={`${cardClass} p-3.5`}>
                                <div className="flex items-center justify-between mb-1.5">
                                    <h3 className="text-xs font-bold">{t('Custom context')}</h3>
                                    <div className="flex items-center gap-2">
                                        {saveState === 'saving' && <span className="text-[10px] text-text-tertiary">{t('Saving...')}</span>}
                                        {saveState === 'saved' && (
                                            <span className="flex items-center gap-1 text-[10px] text-emerald-500">
                                                <Check size={10} /> {t('Saved')}
                                            </span>
                                        )}
                                        <span className="text-[10px] text-text-tertiary">
                                            {contextDraft.length}/{CUSTOM_CONTEXT_MAX}
                                        </span>
                                    </div>
                                </div>
                                <p className="text-[11px] text-text-tertiary mb-2">
                                    {t('Instructions the assistant always keeps in mind for this mode — your product, pricing rules, tone, or anything else worth repeating every call.')}
                                </p>
                                <textarea
                                    value={contextDraft}
                                    onChange={(e) => setContextDraft(e.target.value.slice(0, CUSTOM_CONTEXT_MAX))}
                                    placeholder={t('e.g. We sell mid-market observability tooling. Never discount below 15% without approval. Lead with ROI, not features.')}
                                    rows={5}
                                    className="w-full text-xs leading-relaxed px-3 py-2.5 rounded-lg bg-bg-input border border-border-subtle text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none focus:border-accent-primary"
                                />
                            </div>

                            {/* Reference files */}
                            <div className={`${cardClass} p-3.5`}>
                                <div className="flex items-center justify-between mb-1.5">
                                    <h3 className="text-xs font-bold">{t('Reference files')}</h3>
                                    <button
                                        type="button"
                                        onClick={handleUploadFile}
                                        disabled={uploading}
                                        className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full border border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-muted transition-colors disabled:opacity-50"
                                    >
                                        {uploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                                        {t('Add file')}
                                    </button>
                                </div>
                                <p className="text-[11px] text-text-tertiary mb-2">
                                    {t('Battlecards, pricing sheets, one-pagers, case studies — the assistant grounds its answers in these during a call.')}
                                </p>
                                {files.length === 0 ? (
                                    <div className="text-[11px] text-text-tertiary italic py-2">{t('No files yet.')}</div>
                                ) : (
                                    <div className="space-y-1">
                                        {files.map((f) => {
                                            const status = fileStatuses[f.id]?.status;
                                            return (
                                                <div key={f.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-bg-item-active/50 group">
                                                    <FileText size={13} className="text-text-tertiary shrink-0" />
                                                    <span className="flex-1 text-xs truncate">{f.fileName}</span>
                                                    {status && status !== 'ready' && status !== 'indexed' && (
                                                        <span className="text-[10px] text-text-tertiary flex items-center gap-1 shrink-0">
                                                            <Loader2 size={9} className="animate-spin" /> {status}
                                                        </span>
                                                    )}
                                                    {(status === 'ready' || status === 'indexed') && (
                                                        <span className="text-[10px] text-emerald-500 shrink-0">{t('Indexed')}</span>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteFile(f.id)}
                                                        aria-label={`${t('Remove file')}: ${f.fileName}`}
                                                        className="p-1 rounded text-text-tertiary hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Note sections */}
                            <div className={`${cardClass} p-3.5`}>
                                <div className="flex items-center justify-between mb-1.5">
                                    <h3 className="text-xs font-bold">{t('Call note sections')}</h3>
                                    {!addingSection && (
                                        <button
                                            type="button"
                                            onClick={() => setAddingSection(true)}
                                            className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full border border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-muted transition-colors"
                                        >
                                            <Plus size={11} /> {t('Add section')}
                                        </button>
                                    )}
                                </div>
                                <p className="text-[11px] text-text-tertiary mb-2">
                                    {t('What the post-call summary breaks this mode\'s notes into.')}
                                </p>
                                {addingSection && (
                                    <div className="mb-2 p-2.5 rounded-lg border border-border-subtle space-y-1.5">
                                        <input
                                            autoFocus
                                            value={sectionTitle}
                                            onChange={(e) => setSectionTitle(e.target.value)}
                                            placeholder={t('Section title, e.g. Objections raised')}
                                            className="w-full text-xs px-2 py-1.5 rounded-md bg-bg-input border border-border-subtle text-text-primary placeholder:text-text-tertiary focus:outline-none"
                                        />
                                        <input
                                            value={sectionDesc}
                                            onChange={(e) => setSectionDesc(e.target.value)}
                                            placeholder={t('What goes in this section')}
                                            className="w-full text-xs px-2 py-1.5 rounded-md bg-bg-input border border-border-subtle text-text-primary placeholder:text-text-tertiary focus:outline-none"
                                        />
                                        <div className="flex gap-1.5">
                                            <button
                                                type="button"
                                                onClick={handleAddSection}
                                                disabled={!sectionTitle.trim()}
                                                className="text-xs font-medium px-3 py-1.5 rounded-md bg-accent-primary text-white disabled:opacity-40"
                                            >
                                                {t('Add')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => { setAddingSection(false); setSectionTitle(''); setSectionDesc(''); }}
                                                className="text-xs text-text-tertiary hover:text-text-primary px-2"
                                            >
                                                {t('Cancel')}
                                            </button>
                                        </div>
                                    </div>
                                )}
                                {sections.length === 0 && !addingSection ? (
                                    <div className="text-[11px] text-text-tertiary italic py-2">{t('No custom sections.')}</div>
                                ) : (
                                    <div className="space-y-1">
                                        {sections.map((s) => (
                                            <div key={s.id} className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg hover:bg-bg-item-active/50 group">
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-xs font-medium truncate">{s.title}</div>
                                                    {s.description && <div className="text-[10px] text-text-tertiary truncate">{s.description}</div>}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteSection(s.id)}
                                                    aria-label={`${t('Remove section')}: ${s.title}`}
                                                    className="p-1 rounded text-text-tertiary hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-text-tertiary text-xs">
                            {t('Select or create a mode to configure it.')}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default ModesSettings;
