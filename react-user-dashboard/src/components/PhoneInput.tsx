import PhoneNumberInput from "react-phone-number-input";
import "react-phone-number-input/style.css";
import { normalizeSingaporePhoneNumber } from "../utils/phone";

type PhoneInputProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
};

export function PhoneInput({ value, onChange, disabled = false, placeholder = "Enter phone number", id }: PhoneInputProps) {
  return (
    <PhoneNumberInput
      id={id}
      className="flex min-h-11 w-full rounded-[.5625rem] border border-[var(--hairline-strong,#c8cbd1)] bg-[var(--canvas-soft,#f8f8f6)] text-[var(--ink,#172033)] focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-[var(--accent,#2864ed)] [&_.PhoneInputCountry]:m-0 [&_.PhoneInputCountry]:border-r [&_.PhoneInputCountry]:border-[var(--hairline,#dcdad2)] [&_.PhoneInputCountry]:py-0 [&_.PhoneInputCountry]:pr-2.5 [&_.PhoneInputCountry]:pl-3 [&_.PhoneInputCountrySelectArrow]:text-[var(--muted,#697386)] [&_.PhoneInputInput]:min-w-0 [&_.PhoneInputInput]:rounded-r-[.5625rem] [&_.PhoneInputInput]:border-0 [&_.PhoneInputInput]:bg-transparent [&_.PhoneInputInput]:px-3 [&_.PhoneInputInput]:text-inherit [&_.PhoneInputInput]:outline-0 [&_.PhoneInputInput::placeholder]:text-[var(--muted,#697386)]"
      defaultCountry="SG"
      international
      countryCallingCodeEditable={false}
      placeholder={placeholder}
      value={normalizeSingaporePhoneNumber(value) || undefined}
      disabled={disabled}
      onChange={(nextValue) => onChange(nextValue ?? "")}
    />
  );
}
