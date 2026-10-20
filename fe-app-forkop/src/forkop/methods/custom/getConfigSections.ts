import { Forkop } from '../../types';
import { FORKOP_UCI_PACKAGE } from '../../../constants';

export async function getConfigSections(): Promise<Forkop.ConfigSection[]> {
  await uci.load(FORKOP_UCI_PACKAGE);

  // The backend refuses a configuration holding a section type ConfigSection does not list.
  return uci.sections(FORKOP_UCI_PACKAGE) as Forkop.ConfigSection[];
}
