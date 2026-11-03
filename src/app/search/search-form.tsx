"use client";

import { useActionState } from "react";
import { searchAction } from "./actions";
import type { SearchState } from "./state";

const input = "rounded border px-3 py-2";
const link = "text-blue-700 underline";

export function SearchForm() {
  const [state, action, pending] = useActionState<SearchState, FormData>(searchAction, {});
  const v = state.values ?? {};
  const fe = state.fieldErrors ?? {};
  const err = (m?: string) => (m ? <span role="alert" className="text-sm text-red-600">{m}</span> : null);
  const r = state.result;

  return (
    <>
      <form action={action} className="flex flex-col gap-3">
        {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
        <label className="flex flex-col gap-1 text-sm">
          Chủ đề
          <textarea name="topic" required maxLength={500} rows={3} defaultValue={v.topic} className={input} />
          {err(fe.topic)}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Loại nội dung
            <input name="contentType" required maxLength={100} defaultValue={v.contentType ?? "Bài blog"} className={input} />
            {err(fe.contentType)}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Ngôn ngữ
            <input name="language" required maxLength={50} defaultValue={v.language ?? "Tiếng Việt"} className={input} />
            {err(fe.language)}
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          Giọng văn (tuỳ chọn)
          <input name="tone" maxLength={100} defaultValue={v.tone} className={input} />
          {err(fe.tone)}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Ngân sách (USDC, tuỳ chọn)
            <input name="budgetUsdc" inputMode="decimal" defaultValue={v.budgetUsdc} className={input} />
            {err(fe.budgetUsdc)}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Hạn (tuỳ chọn)
            <input name="deadline" type="date" defaultValue={v.deadline} className={input} />
            {err(fe.deadline)}
          </label>
        </div>
        <button disabled={pending} className="rounded bg-black px-3 py-2 text-white disabled:opacity-50">
          {pending ? "Đang tìm…" : "Tìm freelancer"}
        </button>
      </form>

      {r && (
        <section className="flex flex-col gap-3">
          <p className="text-sm text-zinc-600">Đã tiêu {r.spentUsdc} USDC (test)</p>
          {r.warnings.map((w) => (
            <p key={w} role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{w}</p>
          ))}
          {r.candidates.length === 0 && <p className="text-sm">Không tìm thấy ứng viên phù hợp.</p>}
          {r.candidates.map((c) => (
            <article key={c.profileUrl} className="flex flex-col gap-2 rounded border p-4">
              <h2 className="font-semibold">
                {c.name} {c.handle && <span className="text-sm font-normal text-zinc-500">{c.handle}</span>}
              </h2>
              <a href={c.profileUrl} target="_blank" rel="noopener noreferrer" className={`${link} break-all text-sm`}>
                {c.profileUrl}
              </a>
              {c.sampleUrls.length > 0 && (
                <div className="text-sm">
                  Bài mẫu:
                  <ul className="list-disc pl-5">
                    {c.sampleUrls.map((u) => (
                      <li key={u}>
                        <a href={u} target="_blank" rel="noopener noreferrer" className={`${link} break-all`}>{u}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-sm"><strong>Lý do phù hợp:</strong> {c.fitReason}</p>
              {c.risks.length > 0 && (
                <div className="text-sm">
                  <strong>Rủi ro:</strong>
                  <ul className="list-disc pl-5">
                    {c.risks.map((x, i) => <li key={i}>{x}</li>)}
                  </ul>
                </div>
              )}
              <a
                href={`/jobs/new?candidate=${encodeURIComponent(c.profileUrl)}`}
                className="self-start rounded bg-black px-3 py-2 text-sm text-white">
                Thuê người này
              </a>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
