"use client";

import { useActionState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TextField } from "@/components/ui/input";
import { createGameAction, type ManualGameState } from "../actions";

type Option = { slug: string; name: string };

function TextAreaField({ id, name, label, hint, error, defaultValue, rows = 4 }: {
  id: string; name: string; label: string; hint?: string; error?: string; defaultValue?: string; rows?: number;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="w-full border border-line-input bg-card px-3 py-2 text-sm font-normal text-fg placeholder:text-muted focus:border-ink aria-[invalid=true]:border-error"
      />
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

function Choices({ legend, name, options, selected }: { legend: string; name: string; options: Option[]; selected: string[] | undefined }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-x-6">
        {options.map((option) => (
          <Checkbox key={option.slug} name={name} value={option.slug} label={option.name} defaultChecked={selected?.includes(option.slug)} />
        ))}
      </div>
    </fieldset>
  );
}

export function ManualGameForm({ genres, tags, platforms }: { genres: Option[]; tags: Option[]; platforms: Option[] }): ReactNode {
  const [state, formAction, pending] = useActionState<ManualGameState, FormData>(createGameAction, null);
  const values = state?.values;
  const errors = state?.errors;

  return (
    // noValidate: 브라우저 기본 검증 말풍선 대신 서버가 돌려주는 한국어 안내를 쓴다.
    <form action={formAction} noValidate className="grid gap-6">
      <TextField id="title" name="title" label="제목" required defaultValue={values?.title} error={errors?.title} />
      <TextField id="titleKo" name="titleKo" label="한국어 제목 (선택)" defaultValue={values?.titleKo} error={errors?.titleKo} />
      <TextField id="releaseDate" name="releaseDate" type="date" label="출시일 (선택)" defaultValue={values?.releaseDate} error={errors?.releaseDate} />
      <TextAreaField id="developers" name="developers" label="개발사 (선택)" rows={2} hint="여러 곳이면 줄바꿈이나 쉼표로 나눠 주세요. 이미 있는 회사는 그대로 연결돼요." defaultValue={values?.developers} error={errors?.developers} />
      <TextAreaField id="publishers" name="publishers" label="퍼블리셔 (선택)" rows={2} defaultValue={values?.publishers} error={errors?.publishers} />
      <Choices legend="플랫폼 (선택)" name="platform" options={platforms} selected={values?.platforms} />
      <Choices legend="장르 (선택)" name="genre" options={genres} selected={values?.genres} />
      <Choices legend="태그 (선택)" name="tag" options={tags} selected={values?.tags} />
      <TextAreaField id="summary" name="summary" label="소개 (선택)" rows={6} defaultValue={values?.summary} error={errors?.summary} />
      {state?.error ? (
        <p role="alert" className="text-sm text-error">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
        {pending ? "등록 중…" : "게임 등록하기"}
      </Button>
    </form>
  );
}
