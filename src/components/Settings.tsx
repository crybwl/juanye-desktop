import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Eye, EyeOff, Info, Keyboard, KeyRound, Loader2, Palette, ScanText, Sparkles, X, Zap } from "lucide-react";
import { Button, Field, SharedPill, Kbd, Modal, Segmented, Switch, cx, inputCls, spring, softSpring, useToast } from "../ui";
import { Logo } from "./TitleBar";
import { getOcrPreferences, saveOcrPreferences } from "../ocr";
import { AppearancePicker } from "./AppearancePicker";
import { errorMessage } from "../errors";
import { useAppearance } from "../appearance";
import { TelegramThemePicker } from "./TelegramThemePicker";
import { ScenePatternPicker } from "./ScenePatternPicker";
import { useExperimentalWorkbench } from "../experimental-workbench";
import { version as appVersion } from "../../package.json";

export const ACCENTS: { name: string; c: [string, string] }[] = [
  { name: "长春花", c: ["#9db1ff", "#c4b2ff"] },
  { name: "青碧", c: ["#7fd8d0", "#93c5ff"] },
  { name: "薄荷", c: ["#8fe0a8", "#c8ee8f"] },
  { name: "琥珀", c: ["#f5c26b", "#ff9f7a"] },
  { name: "珊瑚", c: ["#ff9e8a", "#f7a6d0"] },
  { name: "樱紫", c: ["#e3a6ff", "#a6b4ff"] },
];

const TABS = [
  { id: "model", label: "模型服务", icon: <Sparkles size={15} /> },
  { id: "ocr", label: "识别", icon: <ScanText size={15} /> },
  { id: "look", label: "外观", icon: <Palette size={15} /> },
  { id: "keys", label: "快捷键", icon: <Keyboard size={15} /> },
  { id: "about", label: "关于", icon: <Info size={15} /> },
] as const;
type Tab = (typeof TABS)[number]["id"];

const MODELS = ["qwen-vl-max", "qwen-vl-plus"];

function ModelTab() {
  const toast = useToast();
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [show, setShow] = useState(false);
  const [url, setUrl] = useState("https://dashscope.aliyuncs.com/compatible-mode/v1");
  const [model, setModel] = useState("qwen-vl-max");
  const [test, setTest] = useState<"idle" | "loading" | "ok">("idle");
  const [latency, setLatency] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const revision = useRef(0);
  useEffect(() => {
    alive.current = true;
    if (!window.juanye) { setError("浏览器预览无法保存或测试模型，请使用桌面应用。"); return; }
    const loadedRevision = revision.current;
    void window.juanye.getModel().then((config) => {
      if (!alive.current || revision.current !== loadedRevision) return;
      setUrl(config.baseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1");
      setModel(config.model || "qwen-vl-max"); setHasKey(config.hasKey);
    }).catch((error: unknown) => { if (alive.current) setError(errorMessage(error)); });
    return () => { alive.current = false; revision.current++; };
  }, []);
  const changed = () => { revision.current++; setTest("idle"); setError(""); };
  const config = () => ({ baseUrl: url.trim(), model: model.trim(), ...(key.trim() ? { key: key.trim() } : {}) });
  const validate = () => {
    if (!window.juanye) throw new Error("请在桌面应用中配置模型服务。");
    if (!url.trim() || !model.trim()) throw new Error("请填写请求地址和模型名称。");
    if (!hasKey && !key.trim()) throw new Error("首次使用请填写 API Key。");
  };
  async function testConnection() {
    const run = ++revision.current;
    try {
      validate(); setError(""); setTest("loading");
      const result = await window.juanye!.testModel(config());
      if (alive.current && revision.current === run) { setLatency(result.latencyMs); setTest("ok"); }
    } catch (error) { if (alive.current && revision.current === run) { setTest("idle"); setError(errorMessage(error)); } }
  }
  async function save() {
    try {
      validate(); setError(""); setSaving(true);
      await window.juanye!.saveModel(config());
      const persisted = await window.juanye!.getModel();
      if (!persisted.hasKey) throw new Error("密钥未能正确保存，请重试。");
      if (!alive.current) return;
      setHasKey(true); setKey(""); setTest("idle");
      toast({ title: "模型设置已保存", desc: model });
    } catch (error) { if (alive.current) setError(errorMessage(error)); }
    finally { if (alive.current) setSaving(false); }
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto px-8 pb-6 pt-7">
        <div className="flex items-center gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-[#2a55ff] to-[#7a4dff] text-white shadow-[0_10px_30px_-10px_#4b5bff]">
            <Sparkles size={22} />
          </span>
          <div>
            <div className="text-[17px] font-semibold">Qwen 模型设置</div>
          </div>
        </div>

        <Field label="API Key">
          <div className="relative">
            <KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              className={cx(inputCls, "pl-9 pr-10 font-mono tracking-wide")}
              type={show ? "text" : "password"}
              value={key}
              placeholder={hasKey ? "已保存 · 留空不修改" : "输入 API Key"}
              autoComplete="off"
              disabled={saving}
              onChange={(e) => { changed(); setKey(e.target.value); }}
            />
            <button
              onClick={(e) => (e.preventDefault(), setShow((v) => !v))}
              className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-faint transition-colors hover:bg-white/[0.06] hover:text-fg"
              aria-label={show ? "隐藏" : "显示"}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={String(show)} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.12 }}>
                  {show ? <EyeOff size={15} /> : <Eye size={15} />}
                </motion.span>
              </AnimatePresence>
            </button>
          </div>
        </Field>

        <Field label="请求地址">
          <input className={cx(inputCls, "font-mono text-[12.5px]")} value={url} onChange={(e) => { changed(); setUrl(e.target.value); }} disabled={saving} spellCheck={false} />
        </Field>

        <Field label="模型名称">
          <input className={cx(inputCls, "font-mono text-[12.5px]")} value={model} onChange={(e) => { changed(); setModel(e.target.value); }} disabled={saving} spellCheck={false} />
          <div className="mt-2.5 flex flex-wrap gap-2">
            {MODELS.map((m) => {
              const on = m === model;
              return (
                <motion.button
                  key={m}
                  whileTap={{ scale: 0.95 }}
                  disabled={saving}
                  onClick={(e) => { e.preventDefault(); changed(); setModel(m); }}
                  className={cx(
                    "flex h-8 items-center gap-1.5 rounded-lg px-3 font-mono text-[12px] transition-colors",
                    on ? "bg-accent/15 text-accent ring-1 ring-inset ring-accent/40" : "bg-white/[0.04] text-muted ring-1 ring-inset ring-white/[0.08] hover:text-fg",
                  )}
                >
                  <AnimatePresence initial={false}>
                    {on && (
                      <motion.span initial={{ width: 0, opacity: 0 }} animate={{ width: 13, opacity: 1 }} exit={{ width: 0, opacity: 0 }} className="overflow-hidden">
                        <Check size={13} strokeWidth={3} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {m}
                </motion.button>
              );
            })}
          </div>
        </Field>
        {error && <div role="alert" className="rounded-lg bg-danger/10 p-3 text-[12px] text-danger">{error}</div>}
      </div>

      <div className="flex items-center gap-3 border-t border-line px-8 py-4">
        <AnimatePresence mode="wait">
          {test === "ok" && (
            <motion.span key="ok" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5 text-[12.5px] text-ok">
              <Zap size={13} /> 连接正常 · 延迟 {latency} ms
            </motion.span>
          )}
        </AnimatePresence>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            onClick={() => void testConnection()}
            disabled={test === "loading" || saving}
            icon={test === "loading" ? <Loader2 size={14} className="animate-spin" /> : undefined}
          >
            {test === "loading" ? "测试中…" : "测试连接"}
          </Button>
          <Button variant="primary" className="px-6" disabled={saving || test === "loading"} onClick={() => void save()}>
            {saving ? "保存中…" : "保存设置"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Line({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-b border-line py-4 last:border-0">
      <div className="flex-1">
        <div className="text-[13.5px]">{title}</div>
      </div>
      {children}
    </div>
  );
}

function OcrTab() {
  const [preferences, setPreferences] = useState(getOcrPreferences);
  const update = (value: Partial<typeof preferences>) => { const next = { ...preferences, ...value }; setPreferences(next); saveOcrPreferences(next); };
  return (
    <div className="px-8 pt-7">
      <div className="mb-2 text-[17px] font-semibold">识别</div>
      <Line title="默认多题识别">
        <Switch label="默认多题识别" checked={preferences.multiple} onChange={(multiple) => update({ multiple })} />
      </Line>
      <Line title="保留原图">
        <Switch label="保留原图" checked={preferences.keepImage} onChange={(keepImage) => update({ keepImage })} />
      </Line>
    </div>
  );
}

function LookTab({ accent, setAccent, motionPref, setMotionPref }: { accent: number; setAccent: (i: number) => void; motionPref: "full" | "reduced"; setMotionPref: (v: "full" | "reduced") => void }) {
  const [appearance] = useAppearance();
  const [workbench, setWorkbench] = useExperimentalWorkbench();
  return (
    <div className="h-full overflow-y-auto px-8 pb-6 pt-7">
      <div className="mb-5 text-[17px] font-semibold">外观</div>
      <AppearancePicker />
      <Line title="实验性题目编辑台">
        <Switch label="实验性题目编辑台" checked={workbench} onChange={setWorkbench} />
      </Line>
      {appearance === "telegram" && <div className="mt-6"><ScenePatternPicker /><TelegramThemePicker /></div>}
      {appearance !== "telegram" && <><div className="mb-2.5 mt-6 text-[12.5px] font-medium text-muted">强调色</div><div className="flex gap-3">
        {ACCENTS.map((a, i) => (
          <motion.button
            key={a.name}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.92 }}
            transition={spring}
            onClick={() => setAccent(i)}
            className="flex flex-col items-center gap-2"
          >
            <span className="relative grid h-11 w-11 place-items-center rounded-full" style={{ background: `linear-gradient(140deg, ${a.c[0]}, ${a.c[1]})` }}>
              {accent === i && (
                <SharedPill layoutId="accent-ring" transition={spring} className="absolute -inset-[5px] rounded-full ring-2 ring-white/80" />
              )}
              <AnimatePresence>
                {accent === i && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="text-[#0c0f1c]">
                    <Check size={18} strokeWidth={3} />
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
            <span className={cx("text-[12px]", accent === i ? "text-fg" : "text-faint")}>{a.name}</span>
          </motion.button>
        ))}
      </div></>}
      <div className="mt-7">
        <Line title="界面动效">
          <Segmented size="sm" value={motionPref} onChange={setMotionPref} options={[{ value: "full", label: "完整" }, { value: "reduced", label: "减弱" }]} />
        </Line>
      </div>
    </div>
  );
}

const KEYS: [string, string[]][] = [
  ["命令面板", ["Ctrl", "K"]],
  ["编辑 / 排版预览", ["Ctrl", "1 / 2"]],
  ["上一题 / 下一题", ["Alt", "↑ / ↓"]],
  ["新建题目", ["Ctrl", "N"]],
  ["导出 PDF", ["Ctrl", "E"]],
  ["打开设置", ["Ctrl", ","]],
];

export function SettingsDialog({
  open,
  onClose,
  accent,
  setAccent,
  motionPref,
  setMotionPref,
}: {
  open: boolean;
  onClose: () => void;
  accent: number;
  setAccent: (i: number) => void;
  motionPref: "full" | "reduced";
  setMotionPref: (v: "full" | "reduced") => void;
}) {
  const [tab, setTab] = useState<Tab>("model");
  return (
    <Modal open={open} onClose={onClose} className="flex h-[600px] w-[860px] max-w-full">
      <aside className="w-[210px] shrink-0 border-r border-line bg-black/20 p-3">
        <div className="flex items-center gap-2 px-2 pb-4 pt-1.5">
          <Logo size={22} />
          <span className="text-[13px] font-semibold">设置</span>
        </div>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cx("relative mb-0.5 flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-[13px] transition-colors", tab === t.id ? "text-fg" : "text-muted hover:text-fg")}
          >
            {tab === t.id && <SharedPill layoutId="settings-nav" transition={spring} className="absolute inset-0 rounded-lg bg-white/[0.07]" />}
            <span className="relative">{t.icon}</span>
            <span className="relative">{t.label}</span>
          </button>
        ))}
      </aside>
      <main className="relative min-w-0 flex-1">
        <button onClick={onClose} className="absolute right-4 top-4 z-10 grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/[0.06] hover:text-fg" aria-label="关闭">
          <X size={17} />
        </button>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.1 } }}
            transition={softSpring}
            className="h-full"
          >
            {tab === "model" && <ModelTab />}
            {tab === "ocr" && <OcrTab />}
            {tab === "look" && <LookTab accent={accent} setAccent={setAccent} motionPref={motionPref} setMotionPref={setMotionPref} />}
            {tab === "keys" && (
              <div className="px-8 pt-7">
                <div className="mb-2 text-[17px] font-semibold">快捷键</div>
                {KEYS.map(([t, k]) => (
                  <Line key={t} title={t}>
                    <span className="flex gap-1">
                      {k.map((x) => (
                        <Kbd key={x}>{x}</Kbd>
                      ))}
                    </span>
                  </Line>
                ))}
              </div>
            )}
            {tab === "about" && (
              <div className="flex h-full flex-col items-center justify-center pb-10 text-center">
                <motion.div initial={{ rotate: -12, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 14 }}>
                  <Logo size={64} />
                </motion.div>
                <div className="mt-5 text-[20px] font-semibold">卷页</div>
                <div className="mt-1 text-[13px] text-muted">版本 {appVersion}</div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </Modal>
  );
}
