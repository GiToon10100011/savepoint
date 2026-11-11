"use client";

import { Radio } from "@/components/ui/radio";
import { PLAY_STATUSES, playStatusLabel, UNSET_STATUS_LABEL, type PlayStatus } from "@/lib/play-status";

/** 상태 표시. 색 배지를 쓰지 않고 테두리 있는 텍스트만 쓴다. */
export function GameStatusBadge({ status }: { status: PlayStatus | null }) {
  return (
    <span className="inline-flex h-6 items-center border border-line-input px-2 text-xs font-normal text-fg">
      {playStatusLabel(status)}
    </span>
  );
}

type GameStatusPickerProps = {
  /** 현재 상태. 지정하지 않았으면 null(상태 미지정). */
  value: PlayStatus | null;
  onChange: (value: PlayStatus | null) => void;
  /** 같은 화면에 여러 개가 있어도 라디오 그룹이 섞이지 않도록 고유한 이름을 준다. */
  name: string;
};

/** 7가지 상태 + 상태 미지정 중 하나를 고른다. 전환 순서를 강제하지 않는다. */
export function GameStatusPicker({ value, onChange, name }: GameStatusPickerProps) {
  return (
    <fieldset className="m-0 grid gap-1 border-0 p-0">
      <legend className="mb-2 p-0 text-sm font-semibold">플레이 상태</legend>
      {PLAY_STATUSES.map((status) => (
        <Radio
          key={status.value}
          name={name}
          value={status.value}
          label={status.label}
          checked={value === status.value}
          onChange={() => onChange(status.value)}
        />
      ))}
      <Radio name={name} value="" label={UNSET_STATUS_LABEL} checked={value === null} onChange={() => onChange(null)} />
    </fieldset>
  );
}
