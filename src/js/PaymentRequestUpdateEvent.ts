import { Platform } from 'react-native';

import {
  SHIPPING_ADDRESS_CHANGE_EVENT,
  SHIPPING_OPTION_CHANGE_EVENT
} from './constants';

import PaymentRequest from './PaymentRequest';
import NativePayments from './NativePayments';

import {
  validateTotal,
  validateDisplayItems,
  validateShippingOptions,
  convertDetailAmountsToString
} from './helpers';

import { DOMException } from './errors';
import { PaymentDetailsInit, PaymentDetailsUpdate } from './types';

type EventName = typeof SHIPPING_ADDRESS_CHANGE_EVENT | typeof SHIPPING_OPTION_CHANGE_EVENT;

const noop = () => {};

function isPromise(value: any): value is Promise<any> {
  if (!value.then) {
    return false;
  }

  return typeof value.then === 'function';
}

export default class PaymentRequestUpdateEvent {
  name: string;
  target: PaymentRequest;
  _waitForUpdate: boolean;

  constructor(name: EventName, target: PaymentRequest) {
    if (
      name !== SHIPPING_ADDRESS_CHANGE_EVENT &&
      name !== SHIPPING_OPTION_CHANGE_EVENT
    ) {
      throw new Error(
        `Only "${SHIPPING_ADDRESS_CHANGE_EVENT}" and "${SHIPPING_OPTION_CHANGE_EVENT}" event listeners are supported.`
      );
    }

    this.name = name;
    this.target = target;
    this._waitForUpdate = false;

    this._handleDetailsChange = this._handleDetailsChange.bind(this);
    this._resetEvent = this._resetEvent.bind(this);
  }

  _handleDetailsChange(value: PaymentDetailsUpdate) {
    const target = this.target;

    validateTotal(value.total, DOMException);
    validateDisplayItems(value.displayItems, DOMException);

    // 1. Let details be the result of converting value to a PaymentDetailsUpdate dictionary. If this throws an exception, abort the update with the thrown exception.
    const details: PaymentDetailsInit = Object.assign(
      Object.create(null),
      value
    );

    // 2. Let serializedModifierData be an empty list.
    // 3. Let selectedShippingOption be null.
    // 4. Let shippingOptions be an empty sequence<PaymentShippingOption>.
    // 5. Validate and canonicalize the details:

    // 6. Update the PaymentRequest using the new details:
    target._details = details;

    // 6.1 If the total member of details is present, then:
    // if (details.total) {
    //   target._details = Object.assign({}, target._details, { total: details.total });
    // }

    // // 6.2 If the displayItems member of details is present, then:
    // if (details.displayItems) {
    //   target._details = Object.assign({}, target._details, { displayItems: details.displayItems });
    // }

    // // 6.3 If the shippingOptions member of details is present, and target.[[options]].requestShipping is true, then:
    // if (details.shippingOptions && target._options.requestShipping === true) {
    //   // 6.3.1 Set target.[[details]].shippingOptions to shippingOptions.
    //   shippingOptions = details.shippingOptions;
    //   target._details = Object.assign({}, target._details, { shippingOptions });

    //   // 6.3.2 Set the value of target's shippingOption attribute to selectedShippingOption.
    //   selectedShippingOption = target.shippingOption;
    // }

    // // 6.4 If the modifiers member of details is present, then:
    // if (details.modifiers) {
    //   // 6.4.1 Set target.[[details]].modifiers to details.modifiers.
    //   target._details = Object.assign({}, target._details, { modifiers: details.modifiers });

    //   // 6.4.2 Set target.[[serializedModifierData]] to serializedModifierData.
    //   target._serializedModifierData = serializedModifierData;
    // }

    // 6.5 If target.[[options]].requestShipping is true, and target.[[details]].shippingOptions is empty,
    // then the developer has signified that there are no valid shipping options for the currently-chosen shipping address (given by target's shippingAddress).
    // In this case, the user agent should display an error indicating this, and may indicate that that the currently-chosen shipping address is invalid in some way.
    // The user agent should use the error member of details, if it is present, to give more information about why there are no valid shipping options for that address.

    const normalizedDetails = convertDetailAmountsToString(target._details);

    return (
      NativePayments.handleDetailsUpdate(normalizedDetails)
        // 14. Upon fulfillment of detailsPromise with value value
        .then(this._resetEvent)
        // On iOS the `selectedShippingMethod` defaults back to the first option
        // when updating shippingMethods.  So we call the `_handleShippingOptionChange`
        // method with the first shippingOption id so that JS is in sync with Apple Pay.
        .then(() => {
          if (Platform.OS !== 'ios') {
            return;
          }

          if (
            target._details.shippingOptions &&
            target._details.shippingOptions[0]
          ) {
            target._handleShippingOptionChange({
              selectedShippingOptionId: target._details.shippingOptions[0].id
            });
          }
        })
        // 13. Upon rejection of detailsPromise:
        .catch(e => {
          this._resetEvent();

          throw new Error('AbortError');
        })
    );
  }

  _resetEvent() {
    // 1. Set event.[[waitForUpdate]] to false.
    this._waitForUpdate = false;

    // 2. Set target.[[updating]] to false.
    this.target._updating = false;

    // 3. The user agent should update the user interface based on any changed values in target.
    // The user agent should re-enable user interface elements that might have been disabled in the steps above if appropriate.
    noop();
  }

  updateWith(
    PaymentDetailsModifierOrPromise:
      | PaymentDetailsUpdate
      | Promise<PaymentDetailsUpdate>
  ) {
    // 1. Let event be this PaymentRequestUpdateEvent instance.
    let event = this;

    // 2. Let target be the value of event's target attribute.
    let target = this.target;

    // 3. If target is not a PaymentRequest object, then throw a TypeError.
    if (!(target instanceof PaymentRequest)) {
      throw new Error('TypeError');
    }

    // 5. If event.[[waitForUpdate]] is true, then throw an "InvalidStateError" DOMException.
    if (event._waitForUpdate === true) {
      throw new Error('InvalidStateError');
    }

    // 6. If target.[[state]] is not " interactive", then throw an " InvalidStateError" DOMException.
    if (target._state !== 'interactive') {
      throw new Error('InvalidStateError');
    }

    // 7. If target.[[updating]] is true, then throw an "InvalidStateError" DOMException.
    if (target._updating === true) {
      throw new Error('InvalidStateError');
    }

    // 8. Set event's stop propagation flag and stop immediate propagation flag.
    noop();

    // 9. Set event.[[waitForUpdate]] to true.
    event._waitForUpdate = true;

    // 10. Set target.[[updating]] to true.
    target._updating = true;

    // 11. The user agent should disable the user interface that allows the user to accept the payment request.
    // This is to ensure that the payment is not accepted until the web page has made changes required by the change.
    // The web page must settle the detailsPromise to indicate that the payment request is valid again.
    // The user agent should disable any part of the user interface that could cause another update event to be fired.
    // Only one update may be processed at a time.
    noop(); // NativePayments does this for us (iOS does at the time of this comment)

    // 12. Return from the method and perform the remaining steps in parallel.

    if (isPromise(PaymentDetailsModifierOrPromise)) {
      const promise = PaymentDetailsModifierOrPromise;
      return promise.then(this._handleDetailsChange);
    }

    if (typeof PaymentDetailsModifierOrPromise === 'object') {
      const paymentDetailsModifier = PaymentDetailsModifierOrPromise;

      return this._handleDetailsChange(paymentDetailsModifier);
    }
  }
}
