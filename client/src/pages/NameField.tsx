import { forwardRef } from 'react';
import { NICKNAME_MAX } from '@grandma/shared';

const QUICK_NAMES = ['奶奶', '爷爷', '外婆', '外公', '爸爸', '妈妈'];

/** 名字输入：大输入框 + 常用称呼一键填写（不会打字的长辈点一下就行） */
export const NameField = forwardRef<
  HTMLInputElement,
  { value: string; onChange: (v: string) => void; error?: string | null; id?: string }
>(function NameField({ value, onChange, error, id = 'nickname' }, ref) {
  return (
    <div className="name-field">
      <label className="card-title" htmlFor={id}>
        我的名字
      </label>
      <input
        ref={ref}
        id={id}
        className={`input${error ? ' is-error' : ''}`}
        value={value}
        maxLength={NICKNAME_MAX * 2}
        placeholder="写上名字，家人好认出你"
        autoComplete="nickname"
        enterKeyHint="done"
        onChange={(e) => onChange(e.target.value)}
        data-testid="nickname-input"
      />
      {error && <div className="field-error">{error}</div>}
      <div className="chips" role="group" aria-label="常用称呼">
        {QUICK_NAMES.map((n) => (
          <button
            key={n}
            type="button"
            className={`chip${value.trim() === n ? ' is-active' : ''}`}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
});
