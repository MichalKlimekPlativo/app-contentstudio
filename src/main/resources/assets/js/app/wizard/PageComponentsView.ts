import '../../api.ts';
import {LiveEditPageProxy} from './page/LiveEditPageProxy';
import {PageComponentsTreeGrid} from './PageComponentsTreeGrid';
import {SaveAsTemplateAction} from './action/SaveAsTemplateAction';
import {PageView} from '../../page-editor/PageView';
import {ItemViewContextMenu} from '../../page-editor/ItemViewContextMenu';
import {Highlighter} from '../../page-editor/Highlighter';
import {ItemViewSelectedEvent} from '../../page-editor/ItemViewSelectedEvent';
import {ItemViewDeselectedEvent} from '../../page-editor/ItemViewDeselectedEvent';
import {ComponentAddedEvent} from '../../page-editor/ComponentAddedEvent';
import {TextComponentView} from '../../page-editor/text/TextComponentView';
import {TextComponentViewCK} from '../../page-editor/text/TextComponentViewCK';
import {FragmentComponentView} from '../../page-editor/fragment/FragmentComponentView';
import {LayoutComponentView} from '../../page-editor/layout/LayoutComponentView';
import {ComponentRemovedEvent} from '../../page-editor/ComponentRemovedEvent';
import {ComponentLoadedEvent} from '../../page-editor/ComponentLoadedEvent';
import {ComponentResetEvent} from '../../page-editor/ComponentResetEvent';
import {ItemView} from '../../page-editor/ItemView';
import {ComponentView} from '../../page-editor/ComponentView';
import {ClickPosition} from '../../page-editor/ClickPosition';
import {PageViewController} from '../../page-editor/PageViewController';
import Content = api.content.Content;
import TreeNode = api.ui.treegrid.TreeNode;
import DataChangedEvent = api.ui.treegrid.DataChangedEvent;
import ResponsiveManager = api.ui.responsive.ResponsiveManager;
import ResponsiveItem = api.ui.responsive.ResponsiveItem;
import ResponsiveRanges = api.ui.responsive.ResponsiveRanges;
import i18n = api.util.i18n;
import Action = api.ui.Action;
import KeyBinding = api.ui.KeyBinding;
import ObjectHelper = api.ObjectHelper;
import Component = api.content.page.region.Component;

export class PageComponentsView
    extends api.dom.DivEl {

    private content: Content;
    private pageView: PageView;
    private liveEditPage: LiveEditPageProxy;
    private contextMenu: ItemViewContextMenu;

    private responsiveItem: ResponsiveItem;

    private tree: PageComponentsTreeGrid;
    private header: api.dom.H3El;
    private modal: boolean;
    private floating: boolean;
    private draggable: boolean;

    private beforeInsertActionListeners: { (event: any): void }[] = [];

    private mouseDownListener: (event: MouseEvent) => void;
    private mouseUpListener: (event?: MouseEvent) => void;
    private mouseMoveListener: (event: MouseEvent) => void;
    private clickListener: (event: any, data: any) => void;
    private dblClickListener: (event: any, data: any) => void;
    private mouseDown: boolean = false;
    public static debug: boolean = false;

    private invalidItemIds: string[] = [];

    private currentUserHasCreateRights: Boolean;

    private keyBinding: KeyBinding[];

    private beforeActionHandler: (action: Action) => void;

    private afterActionHandler: (action: Action) => void;

    private textComponentsKeyupHandlers: any = {};

    constructor(liveEditPage: LiveEditPageProxy, private saveAsTemplateAction: SaveAsTemplateAction) {
        super('page-components-view');

        this.liveEditPage = liveEditPage;

        this.currentUserHasCreateRights = null;

        this.onHidden((event) => this.hideContextMenu());

        let closeButton = new api.ui.button.CloseButton();
        closeButton.onClicked((event: MouseEvent) => this.hide());

        this.onRemoved(() => {
            if (this.contextMenu) {
                this.contextMenu.remove();
            }
        });

        this.header = new api.dom.H2El('header');
        this.header.setHtml(i18n('field.components'));

        this.appendChildren(<api.dom.Element>closeButton, this.header);

        this.setModal(false).setFloating(true).setDraggable(true);

        this.onShown(() => {
            this.constrainToParent();
            this.getHTMLElement().style.display = '';
            if (this.pageView && this.pageView.isLocked()) {
                this.addClass('locked');
            }
        });

        this.onAdded(() => this.initLiveEditEvents());

        this.responsiveItem = ResponsiveManager.onAvailableSizeChanged(api.dom.Body.get(), (item: ResponsiveItem) => {
            let smallSize = item.isInRangeOrSmaller(ResponsiveRanges._360_540);
            if (!smallSize && this.isVisible()) {
                this.constrainToParent();
            }
            if (item.isRangeSizeChanged()) {
                this.setModal(smallSize).setDraggable(!smallSize);
            }
        });

        this.initKeyBoardBindings();

        this.bindMouseListeners();
    }

    show() {
        api.ui.KeyBindings.get().bindKeys(this.keyBinding);
        super.show();

        if (this.tree) {
            this.tree.getGrid().resizeCanvas();
        }
    }

    hide() {
        super.hide();
        api.ui.KeyBindings.get().unbindKeys(this.keyBinding);
    }

    setPageView(pageView: PageView) {

        this.removeClass('locked');

        this.pageView = pageView;
        if (!this.tree && this.content && this.pageView) {

            this.createTree(this.content, this.pageView);
            this.initLock();

        } else if (this.tree) {

            this.tree.deselectAll();
            Highlighter.get().hide();

            this.tree.setPageView(pageView).then(() => {
                this.initLock();
            });
        }

        this.pageView.onRemoved(() => {
            ResponsiveManager.unAvailableSizeChangedByItem(this.responsiveItem);
        });

        this.pageView.onPageLocked(this.pageLockedHandler.bind(this));
    }

    private initLock() {
        this.unContextMenu(this.lockedViewClickHandler);
        this.unClicked(this.lockedViewClickHandler);

        if (this.pageView.isLocked()) {
            this.addClass('locked');
        }

        this.onContextMenu(this.lockedViewClickHandler);
        this.onClicked(this.lockedViewClickHandler);
    }

    setContent(content: Content) {
        this.content = content;
        if (!this.tree && this.content && this.pageView) {
            this.createTree(this.content, this.pageView);
        }
    }

    private initLiveEditEvents() {
        this.liveEditPage.onItemViewSelected((event: ItemViewSelectedEvent) => {
            if (!event.isNew() && !this.pageView.isLocked()) {
                let selectedItemId = this.tree.getDataId(event.getItemView());
                this.tree.selectNode(selectedItemId, true);
                this.tree.getGrid().focus();
            }
        });

        this.liveEditPage.onItemViewDeselected((event: ItemViewDeselectedEvent) => {
            this.tree.deselectNodes([this.tree.getDataId(event.getItemView())]);
        });

        this.liveEditPage.onComponentAdded((event: ComponentAddedEvent) => {
            let parentNode = this.tree.getRoot().getCurrentRoot().findNode(this.tree.getDataId(event.getParentRegionView()));
            if (parentNode) {
                // deselect all otherwise node is going to be added as child to selection (that is weird btw)
                this.tree.deselectAll();
                let index = event.getParentRegionView().getComponentViews().indexOf(event.getComponentView());
                if (index >= 0) {
                    this.tree.insertNode(event.getComponentView(), false, index, parentNode).then(() => {
                        // expand parent node to show added one
                        this.tree.expandNode(parentNode);

                        if (event.getComponentView().isSelected()) {
                            this.tree.selectNode(this.tree.getDataId(event.getComponentView()));
                        }

                        if (this.tree.hasChildren(event.getComponentView())) {
                            const componentDataId = this.tree.getDataId(event.getComponentView());
                            const componentNode = this.tree.getRoot().getCurrentRoot().findNode(componentDataId);

                            if (event.isDragged()) {
                                this.tree.collapseNode(componentNode, true);
                            } else {
                                this.tree.expandNode(componentNode, true);
                            }
                        }

                        if (api.ObjectHelper.iFrameSafeInstanceOf(event.getComponentView(), TextComponentView) ||
                            api.ObjectHelper.iFrameSafeInstanceOf(event.getComponentView(), TextComponentViewCK)) {
                            this.bindTreeTextNodeUpdateOnTextComponentModify(<TextComponentView>event.getComponentView());
                        }

                        this.constrainToParent();
                        this.highlightInvalidItems();
                    });
                }
            }
        });

        this.liveEditPage.onComponentRemoved((event: ComponentRemovedEvent) => {
            this.tree.deleteNode(event.getComponentView());
            // update parent node in case it was the only child
            this.tree.updateNode(event.getParentRegionView()).then(() => {
                this.tree.refresh();
            });
            this.highlightInvalidItems();
        });

        this.liveEditPage.onComponentLoaded((event: ComponentLoadedEvent) => {
            this.refreshComponentViewNode(event.getNewComponentView(), event.getOldComponentView()).then(() => {
                if (api.ObjectHelper.iFrameSafeInstanceOf(event.getNewComponentView(), FragmentComponentView)) {
                    this.bindTreeFragmentNodeUpdateOnComponentLoaded(<FragmentComponentView>event.getNewComponentView());
                    this.bindFragmentLoadErrorHandler(<FragmentComponentView>event.getNewComponentView());
                    return;
                }
                if (api.ObjectHelper.iFrameSafeInstanceOf(event.getNewComponentView(), LayoutComponentView)) {
                    const componentDataId = this.tree.getDataId(event.getNewComponentView());
                    const componentNode = this.tree.getRoot().getCurrentRoot().findNode(componentDataId);

                    this.tree.expandNode(componentNode);
                    return;
                }
            });
        });

        this.liveEditPage.onComponentReset((event: ComponentResetEvent) => {
            const oldDataId = this.tree.getDataId(event.getOldComponentView());

            this.refreshComponentViewNode(event.getNewComponentView(), event.getOldComponentView());

            this.removeFromInvalidItems(oldDataId);
        });
    }

    private refreshComponentViewNode(componentView: ComponentView<Component>,
                                     oldComponentView: ComponentView<Component>): wemQ.Promise<void> {
        const oldDataId = this.tree.getDataId(oldComponentView);
        const oldNode = this.tree.getRoot().getCurrentRoot().findNode(oldDataId);

        if (this.tree.hasChildren(oldComponentView)) {
            oldNode.removeChildren();
            this.tree.refreshNode(oldNode);
        }

        return this.tree.updateNode(componentView, oldDataId).then(() => {
            this.tree.invalidate();
            const dataId = this.tree.getDataId(componentView);
            if (componentView.isSelected()) {
                this.tree.selectNode(dataId);
                this.scrollToItem(dataId);
            }
        });
    }

    private createTree(content: Content, pageView: PageView) {
        this.tree = new PageComponentsTreeGrid(content, pageView);

        this.clickListener = (event, data) => {
            let elem = new api.dom.ElementHelper(event.target);

            this.hideContextMenu();

            if (elem.hasClass('toggle')) {
                // do nothing if expand toggle is clicked
                return;
            }

            Highlighter.get().hide();

            if (this.isMenuIconClicked(data.cell)) {
                this.showContextMenu(data.row, {x: event.pageX, y: event.pageY});
            }

            if (this.isModal()) {
                this.hide();
            }
        };

        this.dblClickListener = (event, data) => {
            if (this.pageView.isLocked()) {
                return;
            }

            let clickedItemView: ItemView = this.tree.getGrid().getDataView().getItem(data.row).getData();
            let isTextComponent = api.ObjectHelper.iFrameSafeInstanceOf(clickedItemView, TextComponentView) ||
                                  api.ObjectHelper.iFrameSafeInstanceOf(clickedItemView, TextComponentViewCK);

            if (isTextComponent) {
                this.editTextComponent(clickedItemView);
            }
        };

        this.tree.getGrid().subscribeOnClick(this.clickListener);

        this.tree.getGrid().subscribeOnDblClick(this.dblClickListener);

        this.tree.getGrid().subscribeOnMouseEnter((event, data) => {

            if (api.ui.DragHelper.get().isVisible()) {
                return;
            }

            let rowElement = event.target;
            let selected = false;

            while (!rowElement.classList.contains('slick-row')) {
                if (rowElement.classList.contains('selected')) {
                    selected = true;
                }

                rowElement = rowElement.parentElement;
            }

            if (!this.pageView.isLocked()) {
                this.highlightRow(rowElement, selected);
                if (this.isMenuIcon(event.target) && api.BrowserHelper.isIOS()) {
                    this.showContextMenu(new api.dom.ElementHelper(rowElement).getSiblingIndex(), {x: event.pageX, y: event.pageY});
                }
            }
        });

        this.tree.getGrid().subscribeOnMouseLeave((event, data) => {
            Highlighter.get().hide();
        });

        this.tree.onSelectionChanged((data, nodes) => {
            if (nodes.length > 0 && this.isModal()) {
                this.hide();
            }

            let treeNode = data[0];

            if (treeNode && !treeNode.getData().isSelected()) {
                this.selectItem(treeNode);
            }

            this.hideContextMenu();
        });

        this.tree.getGrid().subscribeOnContextMenu((event) => {
            event.stopPropagation();
            event.preventDefault();

            let cell = this.tree.getGrid().getCellFromEvent(event);

            this.showContextMenu(cell.row, {x: event.pageX, y: event.pageY});
        });

        this.appendChild(this.tree);

        this.tree.onRemoved((event) => this.tree.getGrid().unsubscribeOnClick(this.clickListener));
        this.tree.onRemoved((event) => this.tree.getGrid().unsubscribeOnDblClick(this.dblClickListener));

        this.tree.onLoaded(() => {
            this.bindTextComponentViewsUpdateOnTextModify();
            this.subscribeOnFragmentLoadError();
        });

        this.tree.onDataChanged((event: DataChangedEvent<ItemView>) => {
            if (event.getType() !== DataChangedEvent.UPDATED) {
                this.constrainToParent();
            }
        });

        this.tree.getGrid().subscribeOnDrag(() => {
            this.addClass('dragging');
        });

        this.tree.getGrid().subscribeOnDragEnd(() => {
            this.removeClass('dragging');
        });
    }

    private highlightInvalidItems() {
        this.tree.setInvalid(this.invalidItemIds);
    }

    private removeFromInvalidItems(itemId: string) {
        this.invalidItemIds = this.invalidItemIds.filter((curr) => {
            return curr !== itemId;
        });
        this.highlightInvalidItems();
    }

    private addToInvalidItems(itemId: string) {
        this.invalidItemIds.push(itemId);
        this.highlightInvalidItems();
    }

    private isMenuIcon(element: HTMLElement): boolean {
        return !!element && !!element.className && element.className.indexOf('menu-icon') > -1;
    }

    private bindTextComponentViewsUpdateOnTextModify() {
        this.tree.getGrid().getDataView().getItems().map((dataItem) => {
            return dataItem.getData();
        }).filter((itemView: ItemView) => {
            return api.ObjectHelper.iFrameSafeInstanceOf(itemView, TextComponentView) ||
                   api.ObjectHelper.iFrameSafeInstanceOf(itemView, TextComponentViewCK);
        }).filter((textComponentView: TextComponentView) => {
            return !textComponentView.getHTMLElement().onpaste; // filtering text components that already have these listeners
        }).forEach((textComponentView: TextComponentView) => {
            this.bindTreeTextNodeUpdateOnTextComponentModify(textComponentView);
        });
    }

    private subscribeOnFragmentLoadError() {
        this.tree.getGrid().getDataView().getItems().map((dataItem) => {
            return dataItem.getData();
        }).filter((itemView: ItemView) => {
            return api.ObjectHelper.iFrameSafeInstanceOf(itemView, FragmentComponentView);
        }).forEach((fragmentComponentView: FragmentComponentView) => {
            this.bindFragmentLoadErrorHandler(fragmentComponentView);
        });
    }

    private bindTreeTextNodeUpdateOnTextComponentModify(textComponentView: TextComponentView) {
        let handler = api.util.AppHelper.debounce((event) => {
            this.tree.updateNode(textComponentView);
        }, 500, false);

        textComponentView.onKeyUp(handler);
        textComponentView.getHTMLElement().onpaste = handler;
    }

    private bindTreeFragmentNodeUpdateOnComponentLoaded(fragmentComponentView: FragmentComponentView) {
        fragmentComponentView.onFragmentContentLoaded((e) => {
            this.tree.updateNode(e.getFragmentComponentView());
        });
    }

    private bindFragmentLoadErrorHandler(fragmentComponentView: FragmentComponentView) {
        fragmentComponentView.onFragmentLoadError((e) => {
            this.addToInvalidItems(e.getFragmentComponentView().getItemId().toString());

        });
    }

    private initKeyBoardBindings() {
        const removeHandler = () => {
            const selectedNode = this.tree.getSelectedNodes()[0];
            const itemView = selectedNode ? selectedNode.getData() : null;

            if (itemView) {
                if (ObjectHelper.iFrameSafeInstanceOf(itemView, ComponentView)) {
                    itemView.deselect();
                    itemView.remove();
                }
            }
            return true;
        };
        this.keyBinding = [
            new KeyBinding('del', removeHandler),
            new KeyBinding('backspace', removeHandler)
        ];

    }

    private bindMouseListeners() {
        this.lockedViewClickHandler = this.lockedViewClickHandler.bind(this);
    }

    private selectItem(treeNode: TreeNode<ItemView>) {
        treeNode.getData().selectWithoutMenu();
        this.scrollToItem(treeNode.getDataId());
    }

    isDraggable(): boolean {
        return this.draggable;
    }

    setDraggable(draggable: boolean): PageComponentsView {
        let body = api.dom.Body.get();
        if (!this.draggable && draggable) {
            let lastPos;
            if (!this.mouseDownListener) {
                this.mouseDownListener = (event: MouseEvent) => {
                    if (PageComponentsView.debug) {
                        console.log('mouse down', this.mouseDown, event);
                    }
                    if (!this.mouseDown && event.buttons === 1) {
                        // left button was clicked
                        event.preventDefault();
                        event.stopPropagation();
                        this.mouseDown = true;
                        lastPos = {
                            x: event.clientX,
                            y: event.clientY
                        };
                    }
                };
            }
            if (!this.mouseUpListener) {
                this.mouseUpListener = (event?: MouseEvent) => {
                    if (PageComponentsView.debug) {
                        console.log('mouse up', this.mouseDown, event);
                    }
                    if (this.mouseDown) {
                        // left button was released
                        if (event) {
                            event.preventDefault();
                            event.stopPropagation();
                        }

                        this.mouseDown = false;
                    }
                };
            }
            if (!this.mouseMoveListener) {
                this.mouseMoveListener = (event: MouseEvent) => {
                    if (this.mouseDown) {
                        if (event.buttons !== 1) {
                            // button was probably released outside browser window
                            this.mouseUpListener();
                            return;
                        }
                        event.preventDefault();
                        event.stopPropagation();

                        let el = this.getEl();
                        let newPos = {
                            x: event.clientX,
                            y: event.clientY
                        };
                        let offset = el.getOffset();
                        let newOffset = {
                            top: offset.top + newPos.y - lastPos.y,
                            left: offset.left + newPos.x - lastPos.x
                        };

                        this.constrainToParent(newOffset);

                        lastPos = newPos;

                        this.hideContextMenu();
                    }
                };
            }
            this.header.onMouseDown(this.mouseDownListener);
            body.onMouseUp(this.mouseUpListener);
            body.onMouseMove(this.mouseMoveListener);
        } else if (this.draggable && !draggable) {
            this.header.unMouseDown(this.mouseDownListener);
            body.unMouseUp(this.mouseUpListener);
            body.unMouseMove(this.mouseMoveListener);
        }
        this.toggleClass('draggable', draggable);
        this.draggable = draggable;
        return this;
    }

    private constrainToParent(offset?: { top: number; left: number }) {
        const el = this.getEl();
        const elOffset = offset || el.getOffset();
        let parentEl;
        let parentOffset;

        if (this.getParentElement()) {
            parentEl = this.getParentElement().getEl();
            parentOffset = parentEl.getOffset();
        } else {
            parentEl = api.dom.WindowDOM.get();
            parentOffset = {
                top: 0,
                left: 0
            };
        }

        el.setMaxHeightPx(parentEl.getHeight());

        el.setOffset({
            top: Math.max(parentOffset.top, Math.min(elOffset.top, parentOffset.top + parentEl.getHeight() - el.getHeightWithBorder())),
            left: Math.max(parentOffset.left, Math.min(elOffset.left, parentOffset.left + parentEl.getWidth() - el.getWidthWithBorder()))
        });
    }

    isFloating(): boolean {
        return this.floating;
    }

    setFloating(floating: boolean): PageComponentsView {
        this.toggleClass('floating', floating);
        this.floating = floating;
        return this;
    }

    isModal(): boolean {
        return this.modal;
    }

    setModal(modal: boolean): PageComponentsView {
        this.toggleClass('modal', modal);
        if (this.tree) {
            // tree may not be yet initialized
            this.tree.getGrid().resizeCanvas();
        }
        this.modal = modal;
        return this;
    }

    private scrollToItem(dataId: string) {
        let node = this.tree.getRoot().getCurrentRoot().findNode(dataId);

        if (node) {
            node.getData().scrollComponentIntoView();
            this.tree.scrollToRow(this.tree.getGrid().getDataView().getRowById(node.getId()));
        }
    }

    private pageLockedHandler(lock: boolean) {
        this.toggleClass('locked', lock);
        if (this.tree) {
            this.tree.reload();
        }
    }

    private lockedViewClickHandler(event: MouseEvent) {
        event.stopPropagation();
        event.preventDefault();

        if (!this.pageView.isLocked()) {
            return;
        }

        if (this.contextMenu && this.contextMenu.isVisible()) {
            this.hideContextMenu();
        } else {
            this.showContextMenu(null, {x: event.pageX, y: event.pageY});
        }
    }

    private isMenuIconClicked(cellNumber: number): boolean {
        return cellNumber === 1;
    }

    private showContextMenu(row: number, clickPosition: ClickPosition) {
        let node = this.tree.getGrid().getDataView().getItem(row);
        let itemView: ItemView;
        let pageView: PageView;

        if (node) {
            itemView = node.getData();
            pageView = <PageView>itemView.getPageView();
        } else {
            pageView = this.pageView;
        }
        let contextMenuActions: Action[];

        if (pageView.isLocked()) {
            contextMenuActions = pageView.getLockedMenuActions();
        } else {
            contextMenuActions = itemView.getContextMenuActions();
        }

        if (!this.contextMenu) {
            this.contextMenu = new ItemViewContextMenu(null, contextMenuActions, false, false);
            this.contextMenu.onHidden(this.removeMenuOpenStyleFromMenuIcon.bind(this));
        } else {
            this.contextMenu.setActions(contextMenuActions);
        }

        if (this.beforeActionHandler) {
            this.contextMenu.getMenu().unBeforeAction(this.beforeActionHandler);
        } else {
            this.beforeActionHandler = (action: Action) => {

                PageViewController.get().setContextMenuDisabled(true);
                if (action.hasParentAction() && action.getParentAction().getLabel() === i18n('field.insert')) {
                    this.notifyBeforeInsertAction();
                }
            };
        }

        if (this.afterActionHandler) {
            this.contextMenu.getMenu().unAfterAction(this.afterActionHandler);
        } else {
            this.afterActionHandler = (action: Action) => {

                this.hidePageComponentsIfInMobileView(action);

                setTimeout(() => {
                    PageViewController.get().setContextMenuDisabled(false);
                    if (this.getHTMLElement().offsetHeight === 0) { // if PCV not visible, for example fragment created, hide highlighter

                        Highlighter.get().hide();
                    }
                }, 500);
            };
        }

        this.contextMenu.getMenu().onBeforeAction(this.beforeActionHandler);
        this.contextMenu.getMenu().onAfterAction(this.afterActionHandler);

        this.setMenuOpenStyleOnMenuIcon(row);

        this.saveAsTemplateAction.updateVisibility();

        // show menu at position
        let x = clickPosition.x;
        let y = clickPosition.y;

        this.contextMenu.showAt(x, y, false);
    }

    private hidePageComponentsIfInMobileView(action: Action) {
        if (api.BrowserHelper.isMobile() &&
            ((action.hasParentAction() && action.getParentAction().getLabel() === i18n('action.insert'))
             || action.getLabel() === i18n('action.inspect')
             || action.getLabel() === i18n('action.edit')
             || action.getLabel() === i18n('action.duplicate'))) {
            this.hide();
        }
    }

    private setMenuOpenStyleOnMenuIcon(row: number) {
        let stylesHash: Slick.CellCssStylesHash = {};
        stylesHash[row] = {menu: 'menu-open'};
        this.tree.getGrid().setCellCssStyles('menu-open', stylesHash);
    }

    private removeMenuOpenStyleFromMenuIcon() {
        this.tree.getGrid().removeCellCssStyles('menu-open');
    }

    private hideContextMenu() {
        if (this.contextMenu && this.contextMenu.isVisible()) {
            this.contextMenu.hide();
        }
    }

    private highlightRow(rowElement: HTMLElement, selected: boolean): void {
        if (selected) {
            Highlighter.get().hide();
        } else {
            let elementHelper = new api.dom.ElementHelper(rowElement);
            let dimensions = elementHelper.getDimensions();
            let nodes = this.tree.getRoot().getCurrentRoot().treeToList();
            let hoveredNode = nodes[new api.dom.ElementHelper(rowElement).getSiblingIndex()];

            if (hoveredNode) {
                let data = hoveredNode.getData();
                if (/*data.getType().isComponentType() && */!api.BrowserHelper.isMobile()) {
                    Highlighter.get().highlightElement(dimensions,
                        data.getType().getConfig().getHighlighterStyle());
                }
                if (api.BrowserHelper.isIOS()) {
                    this.selectItem(hoveredNode);
                }
            }
        }
    }

    onBeforeInsertAction(listener: (event: any) => void) {
        this.beforeInsertActionListeners.push(listener);
    }

    unBeforeInsertAction(listener: (event: any) => void) {
        this.beforeInsertActionListeners = this.beforeInsertActionListeners.filter((currentListener: (event: any) => void) => {
            return listener !== currentListener;
        });
    }

    private notifyBeforeInsertAction() {
        this.beforeInsertActionListeners.forEach((listener: (event: any) => void) => {
            listener.call(this);
        });
    }

    private editTextComponent(textComponent: ItemView) {
        let contextMenuActions: Action[] = textComponent.getContextMenuActions();

        let editAction: Action;

        contextMenuActions.some((action: Action) => {
            if (action.getLabel() === i18n('action.edit')) {
                editAction = action;
                return true;
            }
        });

        if (editAction) {
            this.hide();
            editAction.execute();
        }
    }
}
