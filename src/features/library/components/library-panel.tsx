"use client";

import { useActionState, useState, useTransition, type ReactNode } from "react";
import { GameStatusBadge, GameStatusPicker } from "@/components/game/game-status";
import { Button } from "@/components/ui/button";
import { Input, TextField } from "@/components/ui/input";
import type { PlayStatus } from "@/lib/play-status";
import {
  addIgdbGameToLibraryAction,
  addToLibraryAction,
  removeFromLibraryAction,
  saveLibraryEntryAction,
  type LibraryErrorCode,
  type SaveEntryState,
} from "../actions";
import type { EntryFormValues } from "../entry-form";
import type { LibraryEntry } from "../library";

/** 이미 서비스에 있는 게임은 id로, 아직 가져오지 않은 IGDB 게임(미리보기)은 IGDB ID로 추가한다. */
export type LibraryTarget = { kind: "game"; gameId: string } | { kind: "igdb"; igdbId: number };
export type PlatformOption = { id: number; name: string };

const MESSAGES: Record<LibraryErrorCode, string> = {
  unauthenticated: "로그인이 필요해요.",
  not_found: "게임을 찾을 수 없어요.",
  unavailable: "게임 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
  invalid: "처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
  failed: "처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
};

/** 라이브러리 영역. 항목이 없으면 추가 버튼, 있으면 상태·진행도·날짜·메모를 고치는 폼이다. */
export function LibraryPanel({ target, entry, platforms }: { target: LibraryTarget; entry: LibraryEntry | null; platforms: PlatformOption[] }) {
  if (target.kind === "game" && entry) return <EntryEditor gameId={target.gameId} entry={entry} platforms={platforms} />;
  return <AddButton target={target} />;
}

function AddButton({ target }: { target: LibraryTarget }) {
  const [error, setError] = useState<LibraryErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    setError(null);
    startTransition(async () => {
      try {
        const result = target.kind === "game" ? await addToLibraryAction({ gameId: target.gameId }) : await addIgdbGameToLibraryAction({ igdbId: target.igdbId });
        if (!result.ok) setError(result.code);
      } catch {
        // 네트워크가 끊겨 호출 자체가 거부돼도 오류 경계(페이지 전체 오류 화면)로 보내지 않고 이 자리에서 알린다.
        setError("failed");
      }
    });
  }

  return (
    <div>
      <Button variant="secondary" onClick={add} disabled={pending} aria-busy={pending}>
        라이브러리에 추가
      </Button>
      {error ? (
        <p role="alert" className="type-body-sm mt-2">
          {MESSAGES[error]}
        </p>
      ) : null}
    </div>
  );
}

const toValues = (entry: LibraryEntry): EntryFormValues => {
  const minutes = entry.playtimeMinutes;
  return {
    status: entry.status ?? "",
    platformId: entry.platformId === null ? "" : String(entry.platformId),
    startedOn: entry.startedOn ?? "",
    clearedOn: entry.clearedOn ?? "",
    perfectedOn: entry.perfectedOn ?? "",
    playtimeHours: minutes === null ? "" : String(Math.floor(minutes / 60)),
    playtimeMinutes: minutes === null ? "" : String(minutes % 60),
    progressPercent: entry.progressPercent === null ? "" : String(entry.progressPercent),
    progressText: entry.progressText ?? "",
    note: entry.note ?? "",
  };
};

/** 브라우저의 오늘 날짜(`YYYY-MM-DD`). 사용자가 `오늘`을 눌러 채운 값을 저장 버튼으로 확정해야 저장된다. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="mt-2 text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} aria-live="polite" className="mt-2 text-xs text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, hasHint: boolean, error?: string) => [hasHint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;

/** 날짜 칸과 `오늘` 버튼. 제어 입력이라 버튼이 값을 바꿀 수 있고, 저장 폼이 다시 그려져도 입력이 유지된다. */
function DateField({ id, name, label, defaultValue, error }: { id: string; name: string; label: string; defaultValue: string; error?: string }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <Field id={id} label={label} error={error}>
      <div className="flex gap-2">
        <Input id={id} name={name} type="date" value={value} onChange={(event) => setValue(event.target.value)} invalid={Boolean(error)} aria-describedby={describedBy(id, false, error)} />
        <Button type="button" variant="secondary" size="sm" className="shrink-0" aria-label={`${label}을 오늘로`} onClick={() => setValue(today())}>
          오늘
        </Button>
      </div>
    </Field>
  );
}

function EntryEditor({ gameId, entry, platforms }: { gameId: string; entry: LibraryEntry; platforms: PlatformOption[] }) {
  const [state, formAction, pending] = useActionState<SaveEntryState, FormData>(saveLibraryEntryAction, null);
  const values = state?.values ?? toValues(entry);
  const errors = state?.errors;

  const [status, setStatus] = useState<PlayStatus | null>(entry.status);
  // 새로 추가한 직후(아무 값도 없을 때)는 펼쳐 두어 바로 채울 수 있게 한다.
  const [open, setOpen] = useState(() => Object.values(toValues(entry)).every((value) => value === ""));
  // 저장한 뒤에 다시 고치기 시작하면 `저장했어요` 안내를 거둔다(어느 저장 결과 이후에 고쳤는지만 기억한다).
  const [editedAfter, setEditedAfter] = useState<SaveEntryState>(null);

  const [removing, startRemoving] = useTransition();
  const [removeError, setRemoveError] = useState<LibraryErrorCode | null>(null);
  function remove() {
    if (!window.confirm("이 게임을 라이브러리에서 지울까요?\n상태·날짜·진행도·메모는 사라져요. 평가와 리뷰는 그대로 남아요.")) return;
    setRemoveError(null);
    startRemoving(async () => {
      try {
        const result = await removeFromLibraryAction({ gameId });
        if (!result.ok) setRemoveError(result.code);
      } catch {
        setRemoveError("failed");
      }
    });
  }

  const platformName = platforms.find((p) => p.id === entry.platformId)?.name;
  const summary = [entry.progressPercent !== null ? `${entry.progressPercent}%` : null, entry.progressText, platformName].filter(Boolean).join(" · ");

  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="border border-line">
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <span className="text-sm font-semibold">라이브러리</span>
        <GameStatusBadge status={entry.status} />
        {summary ? <span className="type-body-sm text-muted">{summary}</span> : null}
      </summary>

      {/* noValidate: 브라우저 기본 검증 말풍선 대신 서버가 돌려주는 한국어 안내를 쓴다. */}
      <form action={formAction} noValidate onChange={() => setEditedAfter(state)} className="grid gap-5 border-t border-line p-3">
        <input type="hidden" name="gameId" value={gameId} />

        <GameStatusPicker name="status" value={status} onChange={setStatus} />
        {errors?.status ? <p className="text-xs text-error">{errors.status}</p> : null}

        <Field id="platformId" label="플랫폼 (선택)" error={errors?.platformId}>
          <select
            id="platformId"
            name="platformId"
            defaultValue={values.platformId}
            aria-invalid={errors?.platformId ? true : undefined}
            aria-describedby={describedBy("platformId", false, errors?.platformId)}
            className="h-10 w-full border border-line-input bg-card px-3 text-sm font-normal text-fg focus:border-ink aria-[invalid=true]:border-error"
          >
            <option value="">선택 안 함</option>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>

        <fieldset className="m-0 grid gap-4 border-0 p-0">
          <legend className="mb-2 p-0 text-sm font-semibold">날짜 (선택)</legend>
          <DateField id="startedOn" name="startedOn" label="플레이 시작일" defaultValue={values.startedOn} error={errors?.startedOn} />
          <DateField id="clearedOn" name="clearedOn" label="엔딩 달성일" defaultValue={values.clearedOn} error={errors?.clearedOn} />
          <DateField id="perfectedOn" name="perfectedOn" label="100% 달성일" defaultValue={values.perfectedOn} error={errors?.perfectedOn} />
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="progressPercent"
            name="progressPercent"
            label="진행도 % (선택)"
            inputMode="numeric"
            maxLength={3}
            defaultValue={values.progressPercent}
            error={errors?.progressPercent}
          />
          <TextField
            id="progressText"
            name="progressText"
            label="진행 상황 (선택)"
            hint="예: 챕터 3 진행 중"
            defaultValue={values.progressText}
            error={errors?.progressText}
          />
        </div>

        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 p-0 text-sm font-semibold">플레이 시간 (선택)</legend>
          <div className="flex items-center gap-2">
            <Input name="playtimeHours" inputMode="numeric" aria-label="플레이 시간(시간)" defaultValue={values.playtimeHours} invalid={Boolean(errors?.playtime)} className="w-24" />
            <span className="text-sm">시간</span>
            <Input name="playtimeMinutes" inputMode="numeric" aria-label="플레이 시간(분)" defaultValue={values.playtimeMinutes} invalid={Boolean(errors?.playtime)} className="w-20" />
            <span className="text-sm">분</span>
          </div>
          {errors?.playtime ? (
            <p aria-live="polite" className="mt-2 text-xs text-error">
              {errors.playtime}
            </p>
          ) : null}
        </fieldset>

        <Field id="note" label="메모 (선택)" hint="나에게만 보여요." error={errors?.note}>
          <textarea
            id="note"
            name="note"
            rows={4}
            defaultValue={values.note}
            aria-invalid={errors?.note ? true : undefined}
            aria-describedby={describedBy("note", true, errors?.note)}
            className="w-full border border-line-input bg-card px-3 py-2 text-sm font-normal text-fg focus:border-ink aria-[invalid=true]:border-error"
          />
        </Field>

        {state?.error ? (
          <p role="alert" className="type-body-sm">
            {state.error}
          </p>
        ) : null}
        {state?.saved && editedAfter !== state ? (
          <p role="status" className="type-body-sm">
            저장했어요.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending} aria-busy={pending}>
            저장
          </Button>
          <Button type="button" variant="destructive" onClick={remove} disabled={removing} aria-busy={removing}>
            라이브러리에서 삭제
          </Button>
        </div>
        {removeError ? (
          <p role="alert" className="type-body-sm">
            {MESSAGES[removeError]}
          </p>
        ) : null}
      </form>
    </details>
  );
}
