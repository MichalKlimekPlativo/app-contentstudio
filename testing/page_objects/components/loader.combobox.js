/**
 * Created on 01.12.2017.
 */
const page = require('../page');
const elements = require('../../libs/elements');
const appConst = require('../../libs/app_const');

var component = {
    container: `//div[contains(@id,'LoaderComboBox')]`,
    modeTogglerButton: `//button[contains(@id,'ModeTogglerButton')]`,
    flatOptionView: `//div[contains(@id,'ImageSelectorViewer')]//img`,

};
const loaderComboBox = Object.create(page, {
    optionsFilterInput: {
        get: function () {
            return `${component.container}` + `${elements.COMBO_BOX_OPTION_FILTER_INPUT}`;
        }
    },
    selectOption: {
        value: function (optionDisplayName) {
            let optionSelector = elements.slickRowByDisplayName(`${component.container}`, optionDisplayName);
            return this.waitForVisible(optionSelector, appConst.TIMEOUT_3).catch(err => {
                throw new Error('option was not found! ' + optionDisplayName + ' ' + err);
            }).then(() => {
                return this.doClick(optionSelector).catch((err) => {
                    this.saveScreenshot('err_select_option');
                    throw new Error('option not found!' + optionDisplayName);
                })
            })
        }
    },
    typeTextAndSelectOption: {
        value: function (optionDisplayName) {
            let optionSelector = elements.slickRowByDisplayName(`${component.container}`, optionDisplayName);
            return this.getDisplayedElements(this.optionsFilterInput).then(result => {
                return this.getBrowser().elementIdValue(result[0].ELEMENT, optionDisplayName);
            }).pause(1000).then(() => {
                return this.doClick(optionSelector).catch((err) => {
                    this.saveScreenshot('err_clicking_on_option');
                    throw new Error('Error when clicking on the option in loadercombobox!' + optionDisplayName);
                }).pause(500);
            })
        }
    },
    getOptionDisplayNames: {
        value: function () {
            //TODO implement it 
        }
    }

});
module.exports = loaderComboBox;


