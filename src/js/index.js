// @flow

import _PaymentRequest from './PaymentRequest';
import { PKPaymentButton } from './PKPaymentButton';
import NativePayments from './NativePayments';

export const ApplePayButton = PKPaymentButton;
export const PaymentRequest = _PaymentRequest;
export const openPaymentSetup = NativePayments.openPaymentSetup;
