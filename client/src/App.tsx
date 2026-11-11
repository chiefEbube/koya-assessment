import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiRequest,
  Booking,
  formatDateTime,
  Slot,
} from "./lib/api";

type BookingPage = { bookings: Booking[]; next_cursor: string | null };
type SlotList = { slots: Slot[] };

function requestKey() {
  return globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function App() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [provider, setProvider] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lookupId, setLookupId] = useState("");
  const [lookupBooking, setLookupBooking] = useState<Booking | null>(null);
  const [bookingEmail, setBookingEmail] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const submissionRef = useRef<{ signature: string; key: string } | null>(null);

  const loadSlots = useCallback(async () => {
    setLoadingSlots(true);
    try {
      const result = await apiRequest<SlotList>("/slots");
      setSlots(result.slots);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load appointments.");
    } finally {
      setLoadingSlots(false);
    }
  }, []);

  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  const providers = useMemo(
    () => [...new Set(slots.map((slot) => slot.provider))].sort(),
    [slots]
  );
  const visibleSlots = slots.filter(
    (slot) => slot.available && (!provider || slot.provider === provider)
  );

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSlot) return;

    const payload = {
      slot_id: selectedSlot.id,
      name: name.trim(),
      email: email.trim().toLowerCase(),
    };
    const signature = JSON.stringify(payload);
    if (submissionRef.current?.signature !== signature) {
      submissionRef.current = { signature, key: requestKey() };
    }

    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const booking = await apiRequest<Booking>("/bookings", {
        method: "POST",
        headers: { "Idempotency-Key": submissionRef.current.key },
        body: JSON.stringify(payload),
      });
      setNotice(`You're booked. Your confirmation number is ${booking.id}.`);
      setLookupBooking(booking);
      setLookupId(booking.id);
      setSelectedSlot(null);
      setName("");
      setEmail(payload.email);
      submissionRef.current = null;
      await loadSlots();
      if (bookingEmail.toLowerCase() === payload.email) {
        await loadBookings(payload.email, true);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not complete the booking.");
    } finally {
      setSubmitting(false);
    }
  }

  async function loadBookings(value = bookingEmail, replace = false, cursor?: string) {
    const normalizedEmail = value.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Enter the email address used for your booking.");
      return;
    }
    setLoadingBookings(true);
    setError("");
    try {
      const query = new URLSearchParams({ email: normalizedEmail, limit: "10" });
      if (cursor) query.set("cursor", cursor);
      const result = await apiRequest<BookingPage>(`/bookings?${query}`);
      setBookings((previous) =>
        replace ? result.bookings : [...previous, ...result.bookings]
      );
      setBookingEmail(normalizedEmail);
      setNextCursor(result.next_cursor);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load your bookings.");
    } finally {
      setLoadingBookings(false);
    }
  }

  async function findBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      const booking = await apiRequest<Booking>(
        `/bookings/${encodeURIComponent(lookupId.trim())}`
      );
      setLookupBooking(booking);
    } catch (lookupError) {
      setLookupBooking(null);
      setError(lookupError instanceof Error ? lookupError.message : "Could not find that booking.");
    }
  }

  async function cancelBooking(booking: Booking) {
    setError("");
    try {
      const updated = await apiRequest<Booking>(
        `/bookings/${encodeURIComponent(booking.id)}`,
        { method: "DELETE" }
      );
      setBookings((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
      if (lookupBooking?.id === updated.id) setLookupBooking(updated);
      setNotice("Your appointment has been cancelled.");
      await loadSlots();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Could not cancel this booking.");
    }
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Clinic home">
          <span className="brand-mark">+</span>
          <span>northstar<span className="brand-light"> clinic</span></span>
        </a>
        <a className="top-link" href="#my-bookings">Manage an appointment <span aria-hidden="true">↗</span></a>
      </header>

      <section className="hero">
        <div className="hero-copy">
          {/* <p className="eyebrow"><span className="pulse-dot" /> CARE THAT FITS YOUR DAY</p> */}
          <h1>Make time<br />for <em>feeling better.</em></h1>
          <p className="hero-description">
            Find a time with a trusted provider. A few clicks is all it takes to get started.
          </p>
          <a className="text-link" href="#appointments">Explore appointments <span aria-hidden="true">↓</span></a>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="sun-disc" />
          <div className="art-arch" />
          <div className="art-leaf leaf-one" />
          <div className="art-leaf leaf-two" />
          <div className="art-leaf leaf-three" />
          <div className="art-line" />
          <span className="art-caption">A little care goes a long way</span>
        </div>
      </section>

      {(error || notice) && (
        <div className={`feedback ${error ? "feedback-error" : "feedback-success"}`} role={error ? "alert" : "status"}>
          <span>{error || notice}</span>
          <button type="button" onClick={() => { setError(""); setNotice(""); }} aria-label="Dismiss message">×</button>
        </div>
      )}

      <section className="appointments-section" id="appointments">
        <div className="section-heading">
          <div>
            <p className="eyebrow">YOUR NEXT STEP</p>
            <h2>Choose a time</h2>
          </div>
          <label className="provider-filter">
            <span>Provider</span>
            <select value={provider} onChange={(event) => setProvider(event.target.value)}>
              <option value="">All providers</option>
              {providers.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>

        {loadingSlots ? (
          <div className="empty-state"><span className="loader" /> Finding available times…</div>
        ) : visibleSlots.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">✳</span>
            <h3>No open times just yet</h3>
            <p>Try another provider, or check back soon for new appointments.</p>
          </div>
        ) : (
          <div className="slot-grid">
            {visibleSlots.map((slot) => (
              <article className="slot-card" key={slot.id}>
                <div className="slot-card-top">
                  <span className="availability"><span /> Available</span>
                  <span className="slot-provider">{slot.provider}</span>
                </div>
                <p className="slot-date">{formatDateTime(slot.start)}</p>
                <p className="slot-duration">
                  {new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(slot.start))}
                  {" — "}
                  {new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(slot.end))}
                </p>
                <button className="button button-outline" onClick={() => { setSelectedSlot(slot); setError(""); }}>
                  Book this time <span aria-hidden="true">↗</span>
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="manage-section" id="my-bookings">
        <div className="manage-intro">
          <p className="eyebrow">ALREADY BOOKED?</p>
          <h2>Your care,<br /><em>on your terms.</em></h2>
          <p>Look up a confirmation or manage your upcoming visits in one place.</p>
        </div>
        <div className="manage-panels">
          <form className="manage-card" onSubmit={findBooking}>
            <span className="card-number">01</span>
            <h3>Find a booking</h3>
            <p>Enter your confirmation number to see appointment details.</p>
            <div className="inline-form">
              <label className="sr-only" htmlFor="booking-id">Confirmation number</label>
              <input id="booking-id" value={lookupId} onChange={(event) => setLookupId(event.target.value)} placeholder="e.g. clx8..." required />
              <button className="button button-dark" type="submit">Look up</button>
            </div>
            {lookupBooking && (
              <BookingSummary
                booking={lookupBooking}
                slot={slots.find((slot) => slot.id === lookupBooking.slot_id)}
                onCancel={cancelBooking}
              />
            )}
          </form>

          <div className="manage-card">
            <span className="card-number">02</span>
            <h3>My appointments</h3>
            <p>See your bookings with the email address you used.</p>
            <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void loadBookings(bookingEmail, true); }}>
              <label className="sr-only" htmlFor="booking-email">Email address</label>
              <input id="booking-email" type="email" value={bookingEmail} onChange={(event) => setBookingEmail(event.target.value)} placeholder="you@example.com" required />
              <button className="button button-dark" type="submit" disabled={loadingBookings}>{loadingBookings ? "Loading…" : "Show mine"}</button>
            </form>
            {bookings.length > 0 && (
              <div className="booking-list">
                {bookings.map((booking) => (
                  <BookingSummary
                    key={booking.id}
                    booking={booking}
                    slot={slots.find((slot) => slot.id === booking.slot_id)}
                    onCancel={cancelBooking}
                    compact
                  />
                ))}
                {nextCursor && (
                  <button className="load-more" type="button" disabled={loadingBookings} onClick={() => void loadBookings(bookingEmail, false, nextCursor)}>
                    {loadingBookings ? "Loading…" : "Load more appointments"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <footer className="footer">
        <a className="brand" href="/"><span className="brand-mark">+</span><span>northstar<span className="brand-light"> clinic</span></span></a>
        <span>Care, made a little easier.</span>
        <a href="#appointments">Back to top ↑</a>
      </footer>

      {selectedSlot && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedSlot(null); }}>
          <section className="booking-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <button className="modal-close" type="button" onClick={() => setSelectedSlot(null)} aria-label="Close booking form">×</button>
            <p className="eyebrow">ONE STEP CLOSER</p>
            <h2 id="modal-title">Book your visit</h2>
            <div className="selected-time"><strong>{formatDateTime(selectedSlot.start)}</strong><span>{selectedSlot.provider}</span></div>
            <form onSubmit={submitBooking} className="booking-form">
              <label htmlFor="name">Your name</label>
              <input id="name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} />
              <label htmlFor="email">Email address</label>
              <input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} />
              <button className="button button-dark button-wide" type="submit" disabled={submitting}>
                {submitting ? "Confirming…" : "Confirm appointment"}
              </button>
              <span className="privacy-note">Your details are only used to manage this appointment.</span>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

function BookingSummary({
  booking,
  slot,
  onCancel,
  compact = false,
}: {
  booking: Booking;
  slot?: Slot;
  onCancel: (booking: Booking) => void;
  compact?: boolean;
}) {
  return (
    <div className={`booking-summary ${compact ? "booking-summary-compact" : ""}`}>
      <div>
        <span className={`booking-status ${booking.status}`}>{booking.status}</span>
        <strong>{booking.name}</strong>
        <span>{slot ? formatDateTime(slot.start) : `Booked ${formatDateTime(booking.created_at)}`} · Ref {booking.id}</span>
      </div>
      {booking.status === "confirmed" && (
        <button type="button" className="cancel-link" onClick={() => onCancel(booking)}>Cancel</button>
      )}
    </div>
  );
}
