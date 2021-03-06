import '../../../api.ts';
import {MoveContentEvent} from '../../move/MoveContentEvent';
import {ContentTreeGrid} from '../ContentTreeGrid';
import Action = api.ui.Action;
import i18n = api.util.i18n;

export class MoveContentAction extends Action {

    constructor(grid: ContentTreeGrid) {
        super(i18n('action.moveMore'));
        this.setEnabled(false);
        this.onExecuted(() => {
            const contents: api.content.ContentSummaryAndCompareStatus[]
                = grid.getSelectedDataList();
            new MoveContentEvent(contents, grid.getRoot().getDefaultRoot()).fire();
        });
    }
}
