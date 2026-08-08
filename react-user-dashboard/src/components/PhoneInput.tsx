import PhoneNumberInput from "react-phone-number-input";
import "react-phone-number-input/style.css";
import { normalizeSingaporePhoneNumber } from "../utils/phone";
import "./PhoneInput.css";

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
      className="vsms-phone-input"
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
