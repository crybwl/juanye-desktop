import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { RectangleHorizontal, RectangleVertical, Check } from "lucide-react";
import type { Exam, Layout } from "../types";
import { Button, Field, SharedPill, Segmented, Slider, Switch, cx, inputCls, spring, softSpring } from "../ui";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: softSpring } }}
      className="border-b border-line py-5 last:border-0"
    >
      <div className="mb-3 text-[11.5px] font-medium uppercase tracking-[0.08em] text-faint">{title}</div>
      <div className="space-y-3.5">{children}</div>
    </motion.div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-fg/90">{label}</span>
      {children}
    </div>
  );
}

function StyleCard({ on, onClick, kind }: { on: boolean; onClick: () => void; kind: "real" | "structured" }) {
  return (
    <motion.button
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      transition={spring}
      onClick={onClick}
      className="relative rounded-xl p-2 text-left ring-1 ring-inset ring-line-strong transition-colors hover:bg-white/[0.02]"
    >
      {on && <SharedPill layoutId="style-ring" transition={spring} className="absolute inset-0 rounded-xl ring-2 ring-inset ring-accent" />}
      <div className="h-[82px] overflow-hidden rounded-lg bg-white p-2.5">
        <div className="mx-auto mb-2 h-1.5 w-14 rounded-sm bg-[#222]" />
        {kind === "real" ? (
          <>
            <div className="mb-1 h-1 w-16 rounded-sm bg-[#444]" />
            {[90, 76, 84, 60].map((w, i) => (
              <div key={i} className="mb-1 h-[3px] rounded-sm bg-[#bbb]" style={{ width: `${w}%` }} />
            ))}
          </>
        ) : (
          <>
            <div className="mb-1.5 flex h-2.5 items-center rounded-r-sm border-l-2 border-[#4458c4] bg-[#eef1fd] pl-1">
              <div className="h-1 w-10 rounded-sm bg-[#4458c4]/70" />
            </div>
            {[86, 70, 80].map((w, i) => (
              <div key={i} className="mb-1 flex items-center gap-1">
                <span className="h-[5px] w-[5px] rounded-full bg-[#4458c4]" />
                <div className="h-[3px] rounded-sm bg-[#bbb]" style={{ width: `${w}%` }} />
              </div>
            ))}
          </>
        )}
      </div>
      <div className="mt-2 flex items-center gap-1.5 px-0.5 text-[12.5px] font-medium">
        {kind === "real" ? "真题风格" : "结构化风格"}
        <AnimatePresence>
          {on && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="text-accent">
              <Check size={13} strokeWidth={3} />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </motion.button>
  );
}

export function LayoutPanel({
  layout,
  setLayout,
  exam,
  setExam,
  onDone,
}: {
  layout: Layout;
  setLayout: (l: Layout) => void;
  exam: Exam;
  setExam: (fn: (e: Exam) => Exam) => void;
  onDone: () => void;
}) {
  const [tab, setTab] = useState<"layout" | "info">("layout");
  const set = <K extends keyof Layout>(k: K, v: Layout[K]) => setLayout({ ...layout, [k]: v });
  return (
    <div className="flex h-full w-[340px] flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line pl-5 pr-3">
        <span className="text-[13px] font-semibold">排版与卷面</span>
        <Button size="sm" variant="ghost" onClick={onDone} className="text-accent hover:text-accent">
          完成
        </Button>
      </div>
      <div className="px-5 pt-4">
        <Segmented
          full
          value={tab}
          onChange={setTab}
          options={[
            { value: "layout", label: "排版" },
            { value: "info", label: "卷面信息" },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
        <AnimatePresence mode="wait" initial={false}>
          {tab === "layout" ? (
            <motion.div
              key="layout"
              initial="hidden"
              animate="show"
              exit={{ opacity: 0, x: -10, transition: { duration: 0.12 } }}
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
            >
              <Group title="卷型">
                <Segmented full size="sm" value={layout.paperMode ?? "questions"} onChange={value => setLayout({ ...layout, paperMode: value, answerSpace: value === "integrated" })} options={[{ value: "questions", label: "普通试卷" }, { value: "integrated", label: "试题答题一体卷" }]} />
              </Group>
              <Group title="风格">
                <div className="grid grid-cols-2 gap-2.5">
                  <StyleCard kind="real" on={layout.style === "real"} onClick={() => set("style", "real")} />
                  <StyleCard kind="structured" on={layout.style === "structured"} onClick={() => set("style", "structured")} />
                </div>
                <Segmented
                  full
                  value={layout.density}
                  onChange={(v) => {
                    const presets = { compact: { fontSize: 9.5, lineHeight: 1.42, questionGap: 1.8, optionGap: 0.8, margin: 11 }, standard: { fontSize: 10.5, lineHeight: 1.65, questionGap: 3, optionGap: 1.2, margin: 14 }, loose: { fontSize: 12, lineHeight: 1.9, questionGap: 4.5, optionGap: 1.8, margin: 18 } };
                    setLayout({ ...layout, density: v, ...presets[v] });
                  }}
                  options={[
                    { value: "compact", label: "紧凑" },
                    { value: "standard", label: "标准" },
                    { value: "loose", label: "宽松" },
                  ]}
                />
              </Group>
              <Group title="页面">
                <Segmented
                  full
                  value={layout.paper}
                  onChange={(v) => set("paper", v)}
                  options={(["A4", "A5", "B5", "Letter"] as const).map((p) => ({ value: p, label: p }))}
                />
                <Segmented
                  full
                  value={layout.orientation}
                  onChange={(v) => set("orientation", v)}
                  options={[
                    { value: "portrait", label: "纵向", icon: <RectangleVertical size={14} /> },
                    { value: "landscape", label: "横向", icon: <RectangleHorizontal size={14} /> },
                  ]}
                />
                <div>
                  <div className="mb-1 text-[13px] text-fg/90">页边距</div>
                  <Slider value={layout.margin} min={6} max={30} onChange={(v) => set("margin", v)} format={(v) => `${v} mm`} />
                </div>
              </Group>
              <Group title="文字">
                <div>
                  <div className="mb-1 text-[13px] text-fg/90">正文字号</div>
                  <Slider value={layout.fontSize} min={9} max={14} step={0.5} onChange={(v) => set("fontSize", v)} format={(v) => `${v} pt`} />
                </div>
                <div>
                  <div className="mb-1 text-[13px] text-fg/90">行距</div>
                  <Slider value={layout.lineHeight} min={1.3} max={2.2} step={0.1} onChange={(v) => set("lineHeight", v)} format={(v) => `${v.toFixed(1)}×`} />
                </div>
              </Group>
              <Group title="选项与题目">
                <div><div className="mb-1 text-[13px] text-fg/90">题距</div><Slider value={layout.questionGap ?? 2.6} min={0} max={15} step={0.2} onChange={v => set("questionGap", v)} format={v => `${v.toFixed(1)} mm`} /></div>
                <div><div className="mb-1 text-[13px] text-fg/90">选项间距</div><Slider value={layout.optionGap ?? 0.6} min={0} max={10} step={0.2} onChange={v => set("optionGap", v)} format={v => `${v.toFixed(1)} mm`} /></div>
                <div>
                  <div className="mb-2 text-[13px] text-fg/90">选项排列</div>
                  <Segmented
                    full
                    size="sm"
                    value={layout.optionCols}
                    onChange={(v) => set("optionCols", v)}
                    options={[
                      { value: "auto", label: "自动" },
                      { value: 4, label: "4 列" },
                      { value: 2, label: "2 列" },
                      { value: 1, label: "1 列" },
                    ]}
                  />
                </div>
                <Row label="显示页码">
                  <Switch checked={layout.pageNumber} onChange={(v) => set("pageNumber", v)} label="显示页码" />
                </Row>
                <Row label="显示每题分值">
                  <Switch checked={layout.showScore} onChange={(v) => set("showScore", v)} label="显示每题分值" />
                </Row>
                <Row label="尽量保持整题同页">
                  <Switch checked={layout.keepTogether} onChange={(v) => set("keepTogether", v)} label="尽量保持整题同页" />
                </Row>
              </Group>
              <Group title="题图">
                <div><div className="mb-1 text-[13px] text-fg/90">右侧题图宽度</div><Slider value={layout.figureWidth ?? 35} min={15} max={55} step={1} onChange={v => set("figureWidth", v)} format={v => `${v}%`} /></div>
                <div><div className="mb-1 text-[13px] text-fg/90">图文间距</div><Slider value={layout.figureGap ?? 3} min={0} max={10} step={0.5} onChange={v => set("figureGap", v)} format={v => `${v.toFixed(1)} mm`} /></div>
              </Group>
              <Group title="卷尾答案">
                <Segmented full size="sm" value={layout.answerMode ?? "full"} onChange={v => set("answerMode", v)} options={[{ value: "none", label: "不附答案" }, { value: "brief", label: "仅答案" }, { value: "full", label: "答案与解析" }]} />
                <Row label="选择、填空速对"><Switch label="选择、填空速对" checked={layout.quickAnswers !== false} onChange={v => set("quickAnswers", v)} /></Row>
              </Group>
            </motion.div>
          ) : (
            <motion.div
              key="info"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10, transition: { duration: 0.12 } }}
              transition={softSpring}
              className="space-y-4 pt-5"
            >
              <Field label="试卷标题">
                <input className={inputCls} value={exam.title} onChange={(e) => setExam((x) => ({ ...x, title: e.target.value }))} />
              </Field>
              <Field label="副标题 / 日期">
                <input className={inputCls} value={exam.subtitle} onChange={(e) => setExam((x) => ({ ...x, subtitle: e.target.value }))} />
              </Field>
              <Field label="考试时长" right={<span className="text-[12px] text-faint">分钟</span>}>
                <input
                  type="number"
                  className={cx(inputCls, "tabular-nums")}
                  value={exam.duration}
                  onChange={(e) => setExam((x) => ({ ...x, duration: Number(e.target.value) || 0 }))}
                />
              </Field>
              <Field label="注意事项" hint="每行一条">
                <textarea
                  rows={8}
                  className={cx(inputCls, "h-auto resize-none py-2.5 leading-relaxed")}
                  value={exam.notice.join("\n")}
                  onChange={(e) => setExam((x) => ({ ...x, notice: e.target.value.split("\n").filter((l, i, a) => l.trim() || i === a.length - 1) }))}
                />
              </Field>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
