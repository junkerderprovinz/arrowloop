import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { createSignInFlow, focusFirstField, labelInside, resetBlocked, showRefusal, signInBlocked, signInStage, type SignInHandlers, type SignInText } from "../signIn.ts";
import { Button } from "./Button.tsx";
import { InfoBubble } from "./InfoBubble.tsx";
import { PasswordField } from "./PasswordField.tsx";
import { TextField } from "./TextField.tsx";

export type { ResetAnswer, SignInAnswer, SignInText } from "../signIn.ts";

// The way into an app with a login ("The sign-in card" in the design
// language). The flow lives in the core; the app answers each step through a
// callback and brings its own words.

/** The label keys behind the card's buttons, which pick their glyphs (see Button). */
export interface SignInLabelKeys {
  signIn: string;
  passkey: string;
  forgot: string;
  back: string;
  setPassword: string;
}

const LABEL_KEYS: SignInLabelKeys = {
  signIn: "signIn",
  passkey: "signInWithPasskey",
  forgot: "forgotPassword",
  back: "back",
  setPassword: "setPassword",
};

export interface SignInCardProps extends SignInHandlers {
  /** The app's logo, as an address or as an inline `<svg>` with a viewBox. It stands 7.5rem tall above the name, as wide as its shape asks. */
  logo?: string | ReactNode;
  /** The page's heading. */
  appName: string;
  text: SignInText;
  /** Offers Sign in with a passkey. Pass it only where a passkey can answer on this address. */
  passkey?: boolean;
  /** Offers Forgot password? and the reset form. */
  reset?: boolean;
  /** The shortest new password the reset form takes, as the server says. */
  minPassword?: number;
  /** One line at the top of the sign-in form, such as "You are signed out". */
  note?: string;
  /** The app's own fields, above the password. */
  fields?: ReactNode;
  /** The app's own buttons, under Sign in and the passkey. */
  actions?: ReactNode;
  /** A step the app runs itself, in place of the card's forms. */
  step?: ReactNode;
  labelKeys?: Partial<SignInLabelKeys>;
  /** The start of the fields' ids: `-password`, `-code`, `-reset-code`, `-new` and `-confirm` follow it. */
  idPrefix?: string;
  /** Puts the focus in the first empty field when the card opens. */
  autoFocus?: boolean;
  /** Classes for the page around the card. */
  className?: string;
}

// A field on the sign-in card. Its label stands inside the field until the
// first key, and above it when the field brings a placeholder or a hint.
export function SignInField({ label, htmlFor, hint, hidden, children }: { label: string; htmlFor: string; hint?: string; hidden?: boolean; children: ReactNode }) {
  const [inside, setInside] = useState(false);
  const was = useRef<string | undefined>(undefined);
  useEffect(() => {
    setInside(labelInside(document.getElementById(htmlFor) as HTMLInputElement | null, label, hint, was.current));
    was.current = label;
  }, [htmlFor, label, hint]);
  return (
    <div data-glim="SignInField" className="glim-signin-field" hidden={hidden}>
      <label htmlFor={htmlFor} className={inside ? "glim-sr-only" : "glim-signin-label"}>
        {label}
        {hint && <InfoBubble tip={hint} />}
      </label>
      {children}
    </div>
  );
}

export function SignInCard({
  logo,
  appName,
  text,
  passkey = false,
  reset = false,
  minPassword = 12,
  note,
  fields,
  actions,
  step,
  labelKeys,
  idPrefix,
  autoFocus = true,
  className,
  ...handlers
}: SignInCardProps) {
  const latest = useRef({ ...handlers, text, minPassword });
  latest.current = { ...handlers, text, minPassword };
  const [flow] = useState(() => createSignInFlow(() => latest.current));
  const s = useSyncExternalStore(flow.subscribe, flow.state, flow.state);
  const ownId = useId();
  const id = (name: string) => `${idPrefix ?? ownId}-${name}`;
  const keys = { ...LABEL_KEYS, ...labelKeys };
  const eye = { show: text.show, hide: text.hide };
  const card = useRef<HTMLDivElement>(null);

  const stage = step ? "step" : signInStage(s);
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || autoFocus) focusFirstField(card.current);
    opened.current = true;
  }, [stage]);

  const refusal = s.refusal;
  useEffect(() => (refusal ? showRefusal(card.current, refusal) : undefined), [refusal?.count]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void flow.submit();
  };
  const error = s.error && (
    <p className="glim-signin-error" role="alert">
      {s.error}
    </p>
  );
  const back = <Button label={text.back} labelKey={keys.back} tone="subtle" data-signin="back" disabled={!!s.busy} onClick={flow.back} />;

  return (
    <div data-glim="SignInCard" className={["glim-signin", className].filter(Boolean).join(" ")}>
      <div ref={card} className="glim-card glim-signin-card">
        <div className="glim-signin-head">
          {logo && (
            <span className="glim-signin-logo" aria-hidden="true">
              {typeof logo === "string" ? <img src={logo} alt="" draggable={false} /> : logo}
            </span>
          )}
          <h1 className="glim-signin-name">{appName}</h1>
        </div>

        {step ??
          (s.view === "reset" ? (
            <form className="glim-signin-form" noValidate onSubmit={submit}>
              <SignInField label={text.resetCode} htmlFor={id("reset-code")} hint={text.resetCodeTip}>
                <TextField
                  id={id("reset-code")}
                  data-signin-field="resetCode"
                  className="glim-signin-log-code"
                  value={s.resetCode}
                  onChange={(e) => flow.set("resetCode", e.target.value)}
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="XXXX-XXXX-XXXX"
                />
              </SignInField>
              <SignInField label={text.newPassword} htmlFor={id("new")}>
                <PasswordField id={id("new")} data-signin-field="newPassword" value={s.newPassword} onChange={(e) => flow.set("newPassword", e.target.value)} autoComplete="new-password" text={eye} />
              </SignInField>
              <SignInField label={text.confirmPassword} htmlFor={id("confirm")}>
                <PasswordField id={id("confirm")} data-signin-field="confirm" value={s.confirm} onChange={(e) => flow.set("confirm", e.target.value)} autoComplete="new-password" text={eye} />
              </SignInField>
              {error}
              {/* Stacked, since the longer translations of the two labels do not fit side by side. */}
              <Button
                label={text.setPassword}
                labelKey={keys.setPassword}
                tone="accent"
                type="submit"
                data-signin="set-password"
                disabled={resetBlocked(s)}
                busy={s.busy === "setPassword"}
                title={s.busy === "setPassword" ? text.saving : undefined}
              />
              {back}
            </form>
          ) : (
            <form className="glim-signin-form" noValidate onSubmit={submit}>
              {note && (
                <p className="glim-signin-note" role="status">
                  {note}
                </p>
              )}
              {!s.viaPasskey && fields}
              {/* Kept while a passkey asks for the code, so the password survives a step back. */}
              <SignInField label={text.password} htmlFor={id("password")} hidden={s.viaPasskey}>
                <PasswordField id={id("password")} data-signin-field="password" value={s.password} onChange={(e) => flow.set("password", e.target.value)} autoComplete="current-password" text={eye} />
              </SignInField>
              {s.needCode && (
                <div className="glim-signin-field">
                  <label htmlFor={id("code")} className="glim-signin-label">
                    {text.code}
                  </label>
                  <TextField
                    id={id("code")}
                    data-signin-field="code"
                    className="glim-signin-code"
                    value={s.code}
                    onChange={(e) => flow.set("code", e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    spellCheck={false}
                    placeholder="000000"
                  />
                  <p className="glim-signin-hint">{text.codeHint}</p>
                </div>
              )}
              {error}
              <Button
                label={text.signIn}
                labelKey={keys.signIn}
                tone="accent"
                type="submit"
                data-signin="submit"
                disabled={signInBlocked(s)}
                busy={s.busy === "signIn"}
                title={s.busy === "signIn" ? text.signingIn : undefined}
              />
              {/* Left out rather than disabled where it cannot work: a disabled
                  control on a sign-in page reads as being locked out. */}
              {!s.needCode && passkey && (
                <Button
                  label={text.passkey}
                  labelKey={keys.passkey}
                  data-signin="passkey"
                  disabled={!!s.busy}
                  busy={s.busy === "passkey"}
                  onClick={() => void flow.passkey()}
                />
              )}
              {!s.needCode && actions}
              {s.needCode
                ? back
                : reset && (
                    <Button
                      label={text.forgot}
                      labelKey={keys.forgot}
                      tone="subtle"
                      data-signin="forgot"
                      disabled={!!s.busy}
                      busy={s.busy === "askCode"}
                      onClick={() => void flow.forgot()}
                    />
                  )}
            </form>
          ))}
      </div>
    </div>
  );
}
