import { validateSingBoxFilePath } from '../../../validators/validateSingBoxFilePath';

export function validateSingBoxPath(value: string, fileName: string) {
  const validation = validateSingBoxFilePath(`${value || ''}`, fileName);
  return validation.valid ? true : validation.message;
}
