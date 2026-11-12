import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiRequest,
  ApiError,
  Booking,
  formatDateTime,
  Slot,
} from "./lib/api";

type BookingPage = { bookings: Booking[]; next_cursor: string | null };
type Doctor = { name: string; available_slots: number };
type DoctorList = { doctors: Doctor[] };
type SlotPage = { slots: Slot[]; next_cursor: string | null };

function requestKey() {
  return globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function doctorInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
  }
  return (words[0] ?? "").slice(0, 2).toUpperCase();
}

function localDateKey(value: string) {
  const date = new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function dateFromKey(value: string) {
  return new Date(`${value}T12:00:00`);
}

function friendlyErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof ApiError)) return fallback;

  switch (error.message) {
    case "slot already booked":
      return "That time was just booked. Please choose another available time.";
    case "slot has already started":
      return "That appointment time has passed. Please choose another time.";
    case "slot not found":
      return "That appointment time is no longer available. Please choose another.";
    case "too many booking attempts":
      return "Please wait a minute before trying to book again.";
    case "booking not found":
      return "We couldn't find an appointment with that confirmation number. Check it and try again.";
    case "booking already cancelled":
      return "This appointment has already been cancelled.";
  }

  if (error.status >= 500) {
    return "We're having trouble right now. Please try again in a moment.";
  }
  if (error.status === 401) {
    return "We couldn't verify your request. Please refresh the page and try again.";
  }
  if (error.status === 400 || error.status === 422) {
    return "Please check the information and try again.";
  }
  return fallback;
}

export default function App() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingDoctors, setLoadingDoctors] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [nextSlotCursor, setNextSlotCursor] = useState<string | null>(null);
  const [slotPage, setSlotPage] = useState(0);
  const [slotCursors, setSlotCursors] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [bookingStep, setBookingStep] = useState<"time" | "details">("time");
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
  const slotsRequestRef = useRef(0);

  const loadDoctors = useCallback(async () => {
    setLoadingDoctors(true);
    try {
      const result = await apiRequest<DoctorList>("/doctors");
      setDoctors(result.doctors);
      setError("");
    } catch (loadError) {
      setError(friendlyErrorMessage(loadError, "We couldn't load available doctors. Please try again."));
    } finally {
      setLoadingDoctors(false);
    }
  }, []);

  const loadSlots = useCallback(async (
    doctor: string,
    cursor?: string
  ): Promise<boolean> => {
    const requestId = ++slotsRequestRef.current;
    setLoadingSlots(true);
    setError("");
    try {
      const query = new URLSearchParams({
        provider: doctor,
        available_only: "true",
        limit: "50",
      });
      if (cursor) query.set("cursor", cursor);
      const result = await apiRequest<SlotPage>(`/slots?${query}`);
      if (requestId !== slotsRequestRef.current) return false;
      setSlots(result.slots);
      setNextSlotCursor(result.next_cursor);
      return true;
    } catch (loadError) {
      if (requestId === slotsRequestRef.current) {
        setError(friendlyErrorMessage(loadError, "We couldn't load available times. Please try again."));
      }
      return false;
    } finally {
      if (requestId === slotsRequestRef.current) setLoadingSlots(false);
    }
  }, []);

  const slotsByDate = useMemo(() => {
    const groups = new Map<string, Slot[]>();
    for (const slot of slots) {
      const date = localDateKey(slot.start);
      const daySlots = groups.get(date) ?? [];
      daySlots.push(slot);
      groups.set(date, daySlots);
    }
    return [...groups.entries()].sort(([first], [second]) =>
      first.localeCompare(second)
    );
  }, [slots]);
  const bookingDateSlots = slotsByDate.find(([date]) => date === selectedDate)?.[1] ?? [];

  useEffect(() => {
    if (selectedDate && !slotsByDate.some(([date]) => date === selectedDate)) {
      setSelectedDate("");
    }
  }, [selectedDate, slotsByDate]);

  async function changeSlotPage(cursor: string | undefined, page: number) {
    if (!selectedDoctor || loadingSlots) return;
    if (!(await loadSlots(selectedDoctor, cursor))) return;
    if (page > slotCursors.length && cursor) {
      setSlotCursors((previous) => [...previous, cursor]);
    }
    setSlotPage(page);
  }

  function chooseCalendarDate(date: string, daySlots: Slot[]) {
    setSelectedDate(date);
    setError("");
    setBookingModalOpen(true);
    if (daySlots.length === 1) {
      setSelectedSlot(daySlots[0]);
      setBookingStep("details");
    } else {
      setSelectedSlot(null);
      setBookingStep("time");
    }
  }

  function closeBookingModal() {
    setBookingModalOpen(false);
    setSelectedSlot(null);
  }

  useEffect(() => {
    void loadDoctors();
  }, [loadDoctors]);

  useEffect(() => {
    if (selectedDoctor) void loadSlots(selectedDoctor);
  }, [loadSlots, selectedDoctor]);

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
      setBookingModalOpen(false);
      await loadDoctors();
      if (selectedDoctor) {
        setSlotPage(0);
        setSlotCursors([]);
        await loadSlots(selectedDoctor);
      }
      if (bookingEmail.toLowerCase() === payload.email) {
        await loadBookings(payload.email, true);
      }
    } catch (submitError) {
      setError(friendlyErrorMessage(submitError, "We couldn't complete your booking. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  async function loadBookings(value = bookingEmail, replace = false, cursor?: string) {
    const normalizedEmail = value.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Enter the email address you used when booking.");
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
      setError(friendlyErrorMessage(loadError, "We couldn't load your appointments. Please try again."));
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
      setError(friendlyErrorMessage(lookupError, "We couldn't find that appointment. Check the confirmation number and try again."));
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
      await loadDoctors();
      if (selectedDoctor) {
        setSlotPage(0);
        setSlotCursors([]);
        await loadSlots(selectedDoctor);
      }
    } catch (cancelError) {
      setError(friendlyErrorMessage(cancelError, "We couldn't cancel this appointment. Please try again."));
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
            <h2>Choose a doctor</h2>
            <p className="section-description">Select a doctor to see their available appointment times.</p>
          </div>
        </div>

        {loadingDoctors ? (
          <div className="empty-state"><span className="loader" /> Finding available doctors…</div>
        ) : doctors.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">✳</span>
            <h3>No doctors available just yet</h3>
            <p>Please check back soon for new appointments.</p>
          </div>
        ) : (
          <div className="doctor-grid">
            {doctors.map((doctor) => (
              <button
                className={`doctor-card ${selectedDoctor === doctor.name ? "doctor-card-selected" : ""}`}
                key={doctor.name}
                type="button"
                aria-pressed={selectedDoctor === doctor.name}
                onClick={() => {
                  if (doctor.name === selectedDoctor) return;
                  slotsRequestRef.current += 1;
                  setSelectedDoctor(doctor.name);
                  setSlots([]);
                  setNextSlotCursor(null);
                  setSlotPage(0);
                  setSlotCursors([]);
                  setSelectedDate("");
                }}
              >
                <span className="doctor-avatar" aria-hidden="true">{doctorInitials(doctor.name)}</span>
                <span className="doctor-card-copy">
                  <strong>{doctor.name}</strong>
                  <span className="doctor-count">
                    {doctor.available_slots} available {doctor.available_slots === 1 ? "time" : "times"}
                  </span>
                </span>
                <span className="doctor-arrow" aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
        )}

        {selectedDoctor && (
          <div className="doctor-times">
            <div className="times-heading">
              <div>
                <h3>Available slots with {selectedDoctor}</h3>
              </div>
              <button
                className="close-times"
                type="button"
                aria-label={`Close available times for ${selectedDoctor}`}
                onClick={() => {
                  slotsRequestRef.current += 1;
                  setSelectedDoctor("");
                  setSlots([]);
                  setNextSlotCursor(null);
                  setSlotPage(0);
                  setSlotCursors([]);
                  setSelectedDate("");
                }}
              >
                ×
              </button>
            </div>
            {loadingSlots && slots.length === 0 ? (
              <div className="empty-state"><span className="loader" /> Finding available times…</div>
            ) : slots.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">✳</span>
                <h3>No open times just yet</h3>
                <p>Choose another doctor, or check back soon for new appointments.</p>
              </div>
            ) : (
              <div className="calendar-view">
                <div className="calendar-days" role="group" aria-label="Choose an available day">
                  {slotsByDate.map(([date, daySlots]) => {
                    const dateValue = dateFromKey(date);
                    return (
                      <button
                        className="calendar-day"
                        key={date}
                        type="button"
                        aria-pressed={selectedDate === date}
                        aria-label={`${new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(dateValue)}, ${daySlots.length} available ${daySlots.length === 1 ? "time" : "times"}`}
                        onClick={() => chooseCalendarDate(date, daySlots)}
                      >
                        <span className="calendar-day-weekday">
                          {new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(dateValue)}
                        </span>
                        <strong className="calendar-day-number">{dateValue.getDate()}</strong>
                        <span className="calendar-day-month">
                          {new Intl.DateTimeFormat(undefined, { month: "short" }).format(dateValue)}
                        </span>
                        <span className="calendar-day-count">{daySlots.length} {daySlots.length === 1 ? "time" : "times"}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="calendar-guidance">Select a day and choose an available time.</p>
                {(slotPage > 0 || nextSlotCursor) && (
                <nav className="slot-pagination" aria-label="Available appointment pages">
                  <button
                    className="slot-page-button"
                    type="button"
                    disabled={loadingSlots || slotPage === 0}
                    onClick={() => {
                      const previousPage = slotPage - 1;
                      const cursor = previousPage === 0
                        ? undefined
                        : slotCursors[previousPage - 1];
                      void changeSlotPage(cursor, previousPage);
                    }}
                  >
                    Previous
                  </button>
                  <span className="slot-page-status" aria-live="polite">
                    Page {slotPage + 1}
                  </span>
                  <button
                    className="slot-page-button"
                    type="button"
                    disabled={loadingSlots || !nextSlotCursor}
                    onClick={() => void changeSlotPage(nextSlotCursor ?? undefined, slotPage + 1)}
                  >
                    {loadingSlots ? "Loading…" : "Next"}
                  </button>
                </nav>
                )}
              </div>
            )}
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

      {bookingModalOpen && selectedDate && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeBookingModal(); }}>
          <section className={`booking-modal ${bookingStep === "time" ? "booking-modal-time" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <button className="modal-close" type="button" onClick={closeBookingModal} aria-label="Close booking form">×</button>
            {bookingStep === "time" ? (
              <>
                <h2 id="modal-title">
                  Select your preferred time for{" "}
                  {new Intl.DateTimeFormat(undefined, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  }).format(dateFromKey(selectedDate))}
                </h2>
                <p className="time-picker-doctor">{selectedDoctor}</p>
                <div className="calendar-time-grid">
                  {bookingDateSlots.map((slot) => (
                    <button
                      className="calendar-time"
                      key={slot.id}
                      type="button"
                      onClick={() => {
                        setSelectedSlot(slot);
                        setBookingStep("details");
                      }}
                    >
                      {new Intl.DateTimeFormat(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(new Date(slot.start))}
                    </button>
                  ))}
                </div>
              </>
            ) : selectedSlot && (
              <>
                <h2 id="modal-title">Book your visit</h2>
                <div className="selected-time"><strong>{formatDateTime(selectedSlot.start)}</strong><span>{selectedSlot.provider}</span></div>
                {bookingDateSlots.length > 1 && (
                  <button
                    className="change-time"
                    type="button"
                    onClick={() => {
                      setSelectedSlot(null);
                      setBookingStep("time");
                    }}
                  >
                    Change time
                  </button>
                )}
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
              </>
            )}
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
