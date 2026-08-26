import { Forkop } from '../../types';
import { FORKOP_UCI_PACKAGE } from '../../../constants';

export async function getConfigSections(): Promise<Forkop.ConfigSection[]> {
  await uci.load(FORKOP_UCI_PACKAGE);

  // uci hands back the generic section shape - a name, a type and whatever
  // options the file happens to carry. Narrowing it to ConfigSection is an
  // assertion about this package only: every section type Forkop writes is
  // listed there, and the backend refuses a configuration holding any other.
  return uci.sections(FORKOP_UCI_PACKAGE) as Forkop.ConfigSection[];
}
