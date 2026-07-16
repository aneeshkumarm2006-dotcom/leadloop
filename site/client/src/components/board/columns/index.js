/**
 * Cell renderer registry — maps a column `type` to its renderer component.
 *
 * Use `cellComponentFor(type)` to look up a renderer; the function returns
 * `TextCell` as a fallback for unknown types so the grid never crashes on
 * a freshly-added type the FE hasn't shipped yet.
 */

import TextCell from './TextCell';
import LongTextCell from './LongTextCell';
import NumberCell from './NumberCell';
import DateCell from './DateCell';
import TimelineCell from './TimelineCell';
import PersonCell from './PersonCell';
import StatusCell from './StatusCell';
import DropdownCell from './DropdownCell';
import TagsCell from './TagsCell';
import CheckboxCell from './CheckboxCell';
import LinkCell from './LinkCell';
import PhoneCell from './PhoneCell';
import EmailCell from './EmailCell';
import LocationCell from './LocationCell';
import FileCell from './FileCell';
import RatingCell from './RatingCell';
import FormulaCell from './FormulaCell';
import ConnectBoardsCell from './ConnectBoardsCell';
import MirrorCell from './MirrorCell';

const CELL_BY_TYPE = {
  text: TextCell,
  long_text: LongTextCell,
  number: NumberCell,
  date: DateCell,
  timeline: TimelineCell,
  person: PersonCell,
  status: StatusCell,
  dropdown: DropdownCell,
  tags: TagsCell,
  checkbox: CheckboxCell,
  link: LinkCell,
  phone: PhoneCell,
  email: EmailCell,
  location: LocationCell,
  file: FileCell,
  rating: RatingCell,
  formula: FormulaCell,
  connect_boards: ConnectBoardsCell,
  mirror: MirrorCell,
};

export const cellComponentFor = (type) => CELL_BY_TYPE[type] || TextCell;

export {
  TextCell,
  LongTextCell,
  NumberCell,
  DateCell,
  TimelineCell,
  PersonCell,
  StatusCell,
  DropdownCell,
  TagsCell,
  CheckboxCell,
  LinkCell,
  PhoneCell,
  EmailCell,
  LocationCell,
  FileCell,
  RatingCell,
  FormulaCell,
  ConnectBoardsCell,
  MirrorCell,
};
