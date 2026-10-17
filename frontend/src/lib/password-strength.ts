// 密碼強度（ASVS 2.1.8）：輸入時的提示，不擋送出——規則只有長度（12 到 128 字元）與伺服器的常見密碼清單。
// 長度最重要；字元種類多一點加分；同一種字元（例如全是數字）或同一段重複扣分。
export type PasswordStrength = 'too-short' | 'weak' | 'fair' | 'strong'

export const MIN_PASSWORD_LENGTH = 12

export const PASSWORD_STRENGTH_LABELS: Record<PasswordStrength, string> = {
  'too-short': '太短',
  weak: '弱',
  fair: '普通',
  strong: '強',
}

export function passwordStrength(password: string): PasswordStrength {
  const length = [...password].length
  if (length < MIN_PASSWORD_LENGTH) return 'too-short'
  const kinds = [/\p{Ll}/u, /\p{Lu}/u, /\p{N}/u, /[\p{P}\p{S}\s]/u, /[^\p{ASCII}]/u].filter((kind) => kind.test(password)).length
  let score = length >= 20 ? 3 : length >= 16 ? 2 : 1
  if (kinds >= 3) score += 1
  if (kinds === 1 || /^(.{1,6}?)\1+$/su.test(password)) score -= 1
  return score >= 3 ? 'strong' : score === 2 ? 'fair' : 'weak'
}
