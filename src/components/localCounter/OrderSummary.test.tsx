// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OrderSummary } from "./OrderSummary";
import { parsePaymentAmountMinor } from "@/lib/localFirst/payment";
import type { CounterCatalogue, CounterQuote } from "@/lib/localFirst/counter";

const catalogue: CounterCatalogue = { garments: [{id:"g1",key:"shirt",nameEn:"Shirt",nameMr:"शर्ट",category:"tops",imageKey:"shirt",billingUnit:"piece",active:true}], services: [{id:"s1",key:"wash_iron",name:"Wash + Iron",active:true}], rates: [] };
const quote: CounterQuote = { lines:[{garmentId:"g1",serviceId:"s1",garment:"Shirt",service:"Wash + Iron",quantity:1,unitPriceMinor:1200,lineTotalMinor:1200,rateVersion:2}],subtotalMinor:1200,totalMinor:1200,pieceCount:1,promisedAt:"2026-10-17T11:30:00Z",catalogueVersion:"2" };
const props = (overrides: Partial<React.ComponentProps<typeof OrderSummary>> = {}) => ({ catalogue, lines:{"g1|s1":1}, quote, customer:{name:"Rita",phone:"9876543210"}, payment:"", onPayment:vi.fn(), paymentError:"", onPaymentError:vi.fn(), paymentMethod:"cash" as const, onPaymentMethod:vi.fn(), onRemove:vi.fn(), onQuantity:vi.fn(), onSave:vi.fn(), busy:false, ...overrides });
afterEach(cleanup);
describe("OrderSummary payment and item controls",()=>{
 it("parses only finite, nonnegative paise amounts",()=>{expect(parsePaymentAmountMinor("")).toBe(0);expect(parsePaymentAmountMinor("15.5")).toBe(1550);for(const value of ["-1","NaN","Infinity","1.001","1e4","90071992547409.92"])expect(parsePaymentAmountMinor(value)).toBeNull();});
 it("renders the saved quote, adjusts and removes lines, and submits an exact payment",()=>{const p=props({payment:"12.00"});render(<OrderSummary {...p}/>);expect(screen.getByText("17 Oct 2026, 5:00 pm")).toBeTruthy();expect(screen.getAllByText(/₹12.00/).length).toBeGreaterThanOrEqual(2);fireEvent.click(screen.getByRole("button",{name:"Decrease Shirt"}));fireEvent.click(screen.getByRole("button",{name:"Increase Shirt"}));fireEvent.click(screen.getByRole("button",{name:"Remove Shirt"}));fireEvent.click(screen.getByRole("button",{name:"Save & Print"}));expect(p.onQuantity).toHaveBeenCalledTimes(2);expect(p.onRemove).toHaveBeenCalledWith("g1","s1");expect(p.onSave).toHaveBeenCalledOnce();});
 it("shows empty/quote-pending states and disables invalid, excessive, or busy payment",()=>{const p=props({lines:{},quote:null});const view=render(<OrderSummary {...p}/>);expect(screen.getByText("Tap garment pictures to add items.")).toBeTruthy();expect((screen.getByRole("button",{name:"Save & Print"}) as HTMLButtonElement).disabled).toBe(true);view.rerender(<OrderSummary {...props({payment:"1.001"})}/>);expect((screen.getByRole("button",{name:"Save & Print"}) as HTMLButtonElement).disabled).toBe(true);view.rerender(<OrderSummary {...props({payment:"12.01"})}/>);expect((screen.getByRole("button",{name:"Save & Print"}) as HTMLButtonElement).disabled).toBe(true);view.rerender(<OrderSummary {...props({busy:true})}/>);expect((screen.getByRole("button",{name:/Saving and dispatching/}) as HTMLButtonElement).disabled).toBe(true);});
 it("clears visible payment validation when the amount changes",()=>{const p=props({paymentError:"Enter a valid amount."});render(<OrderSummary {...p}/>);fireEvent.change(screen.getByLabelText("Payment amount (optional)"),{target:{value:"5.25"}});expect(p.onPayment).toHaveBeenCalledWith("5.25");expect(p.onPaymentError).toHaveBeenCalledWith("");});
});
