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
type SlotList = { slots: Slot[] };
type InlineMessage = { type: "error" | "success" | "info"; text: string };
type BookingMessageLocation = "lookup" | "appointments";

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
  const [slotById, setSlotById] = useState<Record<string, Slot>>({});
  const [loadingDoctors, setLoadingDoctors] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [bookingStep, setBookingStep] = useState<"time" | "details">("time");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [availabilityError, setAvailabilityError] = useState("");
  const [bookingError, setBookingError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState<{
    booking: Booking;
    slot: Slot;
  } | null>(null);
  const [lookupId, setLookupId] = useState("");
  const [lookupBooking, setLookupBooking] = useState<Booking | null>(null);
  const [lookupMessage, setLookupMessage] = useState<InlineMessage | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [bookingDetailsOpen, setBookingDetailsOpen] = useState(false);
  const [pendingCancellation, setPendingCancellation] = useState<{
    booking: Booking;
    location: BookingMessageLocation;
  } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [bookingEmail, setBookingEmail] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [appointmentsError, setAppointmentsError] = useState("");
  const [appointmentsMessage, setAppointmentsMessage] = useState<InlineMessage | null>(null);
  const [bookingMessages, setBookingMessages] = useState<Record<string, InlineMessage>>({});
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const submissionRef = useRef<{ signature: string; key: string } | null>(null);
  const slotsRequestRef = useRef(0);
  const cancelledBookingIdsRef = useRef(new Set<string>());

  const loadDoctors = useCallback(async () => {
    setLoadingDoctors(true);
    setAvailabilityError("");
    try {
      const result = await apiRequest<SlotList>("/slots");
      setSlotById(Object.fromEntries(result.slots.map((slot) => [slot.id, slot])));
      const availableByProvider = new Map<string, number>();
      for (const slot of result.slots) {
        if (slot.available) {
          availableByProvider.set(
            slot.provider,
            (availableByProvider.get(slot.provider) ?? 0) + 1
          );
        }
      }
      setDoctors(
        [...availableByProvider.entries()]
          .map(([name, available_slots]) => ({ name, available_slots }))
          .sort((first, second) => first.name.localeCompare(second.name))
      );
    } catch (loadError) {
      setAvailabilityError(friendlyErrorMessage(loadError, "We couldn't load available doctors. Please try again."));
    } finally {
      setLoadingDoctors(false);
    }
  }, []);

  const loadSlots = useCallback(async (doctor: string): Promise<boolean> => {
    const requestId = ++slotsRequestRef.current;
    setLoadingSlots(true);
    setAvailabilityError("");
    try {
      const query = new URLSearchParams({ provider: doctor });
      const result = await apiRequest<SlotList>(`/slots?${query}`);
      if (requestId !== slotsRequestRef.current) return false;
      setSlots(result.slots.filter((slot) => slot.available));
      return true;
    } catch (loadError) {
      if (requestId === slotsRequestRef.current) {
        setAvailabilityError(friendlyErrorMessage(loadError, "We couldn't load available times. Please try again."));
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

  function chooseCalendarDate(date: string, daySlots: Slot[]) {
    setSelectedDate(date);
    setBookingError("");
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
    setBookingError("");
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
    setBookingError("");
    try {
      const booking = await apiRequest<Booking>("/bookings", {
        method: "POST",
        headers: { "Idempotency-Key": submissionRef.current.key },
        body: JSON.stringify(payload),
      });
      setLookupMessage(null);
      setLookupBooking(null);
      setLookupId("");
      setBookingDetailsOpen(false);
      setBookingSuccess({ booking, slot: selectedSlot });
      setSelectedSlot(null);
      setName("");
      setEmail(payload.email);
      submissionRef.current = null;
      setBookingModalOpen(false);
      await loadDoctors();
      if (selectedDoctor) {
        await loadSlots(selectedDoctor);
      }
      if (bookingEmail.toLowerCase() === payload.email) {
        await loadBookings(payload.email, true);
      }
    } catch (submitError) {
      setBookingError(friendlyErrorMessage(submitError, "We couldn't complete your booking. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  async function loadBookings(value = bookingEmail, replace = false, cursor?: string) {
    const normalizedEmail = value.trim().toLowerCase();
    setAppointmentsError("");
    setAppointmentsMessage(null);
    if (!normalizedEmail) {
      setAppointmentsError("Enter the email address you used when booking.");
      return;
    }
    setLoadingBookings(true);
    try {
      const query = new URLSearchParams({ email: normalizedEmail, limit: "10" });
      if (cursor) query.set("cursor", cursor);
      const result = await apiRequest<BookingPage>(`/bookings?${query}`);
      const activeBookings = result.bookings.filter(
        (booking) =>
          booking.status === "confirmed" &&
          !cancelledBookingIdsRef.current.has(booking.id)
      );
      setBookings((previous) =>
        replace ? activeBookings : [...previous, ...activeBookings]
      );
      setBookingEmail(normalizedEmail);
      setNextCursor(result.next_cursor);
      if (activeBookings.length === 0 && (replace || bookings.length === 0)) {
        setAppointmentsMessage({
          type: "info",
          text: result.next_cursor
            ? "No active appointments on this page. Load more to continue."
            : "No appointments found for that email address.",
        });
      }
    } catch (loadError) {
      setAppointmentsError(friendlyErrorMessage(loadError, "We couldn't load your appointments. Please try again."));
    } finally {
      setLoadingBookings(false);
    }
  }

  async function findBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLookupMessage(null);
    setLookupBooking(null);
    setLookingUp(true);
    try {
      const booking = await apiRequest<Booking>(
        `/bookings/${encodeURIComponent(lookupId.trim())}`
      );
      if (booking.status === "cancelled") {
        setBookingDetailsOpen(false);
        setLookupMessage({
          type: "info",
          text: "Appointment not found or has been cancelled.",
        });
        return;
      }
      setLookupBooking(booking);
      setBookingDetailsOpen(true);
      if (!slotById[booking.slot_id]) {
        try {
          const result = await apiRequest<SlotList>("/slots");
          const slotsById = Object.fromEntries(
            result.slots.map((slot) => [slot.id, slot])
          );
          setSlotById(slotsById);
          if (!slotsById[booking.slot_id]) {
            setLookupMessage({
              type: "error",
              text: "We found the booking, but couldn't load its appointment details.",
            });
          }
        } catch (detailsError) {
          setLookupMessage({
            type: "error",
            text: friendlyErrorMessage(
              detailsError,
              "We found the booking, but couldn't load its appointment details."
            ),
          });
        }
      }
    } catch (lookupError) {
      setLookupBooking(null);
      setLookupMessage({
        type: "error",
        text: friendlyErrorMessage(lookupError, "Appointment not found or has been cancelled."),
      });
    } finally {
      setLookingUp(false);
    }
  }

  async function cancelBooking(
    booking: Booking,
    location: BookingMessageLocation
  ) {
    const messageKey = `${location}:${booking.id}`;
    setBookingMessages((previous) => {
      const next = { ...previous };
      delete next[messageKey];
      return next;
    });
    try {
      const updated = await apiRequest<Booking>(
        `/bookings/${encodeURIComponent(booking.id)}`,
        { method: "DELETE" }
      );
      cancelledBookingIdsRef.current.add(updated.id);
      setBookings((current) =>
        current.filter((item) => item.id !== updated.id)
      );
      if (lookupBooking?.id === updated.id) {
        setLookupBooking(null);
        setBookingDetailsOpen(false);
        setLookupMessage({
          type: "info",
          text: "Appointment not found or has been cancelled.",
        });
      }
      if (location === "appointments") {
        setAppointmentsMessage({
          type: "success",
          text: "The appointment has been cancelled.",
        });
      }
      await loadDoctors();
      if (selectedDoctor) {
        await loadSlots(selectedDoctor);
      }
    } catch (cancelError) {
      setBookingMessages((previous) => ({
        ...previous,
        [messageKey]: {
          type: "error",
          text: friendlyErrorMessage(cancelError, "We couldn't cancel this appointment. Please try again."),
        },
      }));
    }
  }

  function requestCancellation(
    booking: Booking,
    location: BookingMessageLocation
  ) {
    setPendingCancellation({ booking, location });
  }

  async function confirmCancellation() {
    if (!pendingCancellation || cancelling) return;
    setCancelling(true);
    try {
      await cancelBooking(
        pendingCancellation.booking,
        pendingCancellation.location
      );
    } finally {
      setPendingCancellation(null);
      setCancelling(false);
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
          <a className="text-link" href="#appointments">Book an appointment <span aria-hidden="true">↓</span></a>
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

      <section className="appointments-section" id="appointments">
        <div className="section-heading">
          <div>
            <h2>Choose a doctor</h2>
            <p className="section-description">Select a doctor to see their available appointment times.</p>
          </div>
        </div>

        {availabilityError && (
          <InlineFeedback message={{ type: "error", text: availabilityError }} />
        )}

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
              </div>
            )}
          </div>
        )}
      </section>

      <section className="manage-section" id="my-bookings">
        <div className="manage-intro">
          <p className="eyebrow">ALREADY BOOKED?</p>
          <h2>Manage your<br /><em>appointments.</em></h2>
          <p>Look up a confirmation or manage your upcoming visits in one place.</p>
        </div>
        <form className="manage-card manage-lookup-card" onSubmit={findBooking}>
          <h3>Find a booking</h3>
          <p>Enter your confirmation number to see appointment details.</p>
          <div className="inline-form">
            <label className="sr-only" htmlFor="booking-id">Confirmation number</label>
            <input id="booking-id" value={lookupId} onChange={(event) => { setLookupId(event.target.value); setLookupMessage(null); setLookupBooking(null); }} placeholder="e.g. clx8..." required />
            <button className="button button-dark" type="submit" disabled={lookingUp}>
              {lookingUp ? "Looking up…" : "Look up"}
            </button>
          </div>
          {lookupMessage && <InlineFeedback message={lookupMessage} />}
          {lookupBooking && (
            <BookingSummary
              booking={lookupBooking}
              slot={slotById[lookupBooking.slot_id]}
              onCancel={requestCancellation}
              onDetails={() => setBookingDetailsOpen(true)}
              message={bookingMessages[`lookup:${lookupBooking.id}`]}
            />
          )}
        </form>

        <div className="manage-card appointments-card">
          <h3>My appointments</h3>
          <p>See your bookings with the email address you used.</p>
          <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void loadBookings(bookingEmail, true); }}>
            <label className="sr-only" htmlFor="booking-email">Email address</label>
            <input id="booking-email" type="email" value={bookingEmail} onChange={(event) => { setBookingEmail(event.target.value); setAppointmentsError(""); setAppointmentsMessage(null); }} placeholder="you@example.com" required />
            <button className="button button-dark" type="submit" disabled={loadingBookings}>{loadingBookings ? "Loading…" : "Show mine"}</button>
          </form>
          {appointmentsError && (
            <InlineFeedback message={{ type: "error", text: appointmentsError }} />
          )}
          {appointmentsMessage && <InlineFeedback message={appointmentsMessage} />}
          {(bookings.length > 0 || nextCursor) && (
            <div className="booking-list">
              {bookings.map((booking) => (
                <BookingSummary
                  key={booking.id}
                  booking={booking}
                  slot={slotById[booking.slot_id]}
                  onCancel={requestCancellation}
                  message={bookingMessages[`appointments:${booking.id}`]}
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
      </section>

      <footer className="footer">
        <a className="brand" href="/"><span className="brand-mark">+</span><span>northstar<span className="brand-light"> clinic</span></span></a>
        <span>Care, made a little easier.</span>
        <a href="#appointments">Back to top ↑</a>
      </footer>

      {bookingSuccess && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setBookingSuccess(null);
            }
          }}
        >
          <section
            className="booking-modal booking-success-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="booking-success-title"
          >
            <button
              className="modal-close"
              type="button"
              onClick={() => setBookingSuccess(null)}
              aria-label="Close booking confirmation"
            >
              ×
            </button>
            <p className="eyebrow">BOOKING CONFIRMED</p>
            <h2 id="booking-success-title">You're booked!</h2>
            <p className="cancellation-description">
              Save your confirmation number to look up or manage this appointment.
            </p>
            <dl className="booking-details-list">
              <div><dt>Confirmation number</dt><dd>{bookingSuccess.booking.id}</dd></div>
              <div><dt>Doctor</dt><dd>{bookingSuccess.slot.provider}</dd></div>
              <div><dt>Appointment time</dt><dd>{formatDateTime(bookingSuccess.slot.start)}</dd></div>
              <div><dt>Name</dt><dd>{bookingSuccess.booking.name}</dd></div>
              <div><dt>Email</dt><dd>{bookingSuccess.booking.email}</dd></div>
            </dl>
            <button
              className="button button-dark button-wide"
              type="button"
              onClick={() => setBookingSuccess(null)}
            >
              Close
            </button>
          </section>
        </div>
      )}

      {pendingCancellation && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !cancelling) {
              setPendingCancellation(null);
            }
          }}
        >
          <section
            className="booking-modal cancellation-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cancellation-title"
            aria-describedby="cancellation-description"
          >
            <button
              className="modal-close"
              type="button"
              onClick={() => setPendingCancellation(null)}
              aria-label="Close cancellation confirmation"
              disabled={cancelling}
            >
              ×
            </button>
            <h2 id="cancellation-title">Cancel this appointment?</h2>
            <p id="cancellation-description" className="cancellation-description">
              {pendingCancellation.booking.name}'s appointment
              {slotById[pendingCancellation.booking.slot_id] && (
                <> with {slotById[pendingCancellation.booking.slot_id].provider} on{" "}
                  {formatDateTime(slotById[pendingCancellation.booking.slot_id].start)}</>
              )}{" "}
              will be cancelled.
            </p>
            <div className="cancellation-actions">
              <button
                className="button button-light"
                type="button"
                onClick={() => setPendingCancellation(null)}
                disabled={cancelling}
              >
                Keep appointment
              </button>
              <button
                className="button button-cancel"
                type="button"
                onClick={() => void confirmCancellation()}
                disabled={cancelling}
              >
                {cancelling ? "Cancelling…" : "Cancel appointment"}
              </button>
            </div>
          </section>
        </div>
      )}

      {bookingDetailsOpen && lookupBooking && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setBookingDetailsOpen(false);
            }
          }}
        >
          <section
            className="booking-modal booking-details-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="booking-details-title"
          >
            <button
              className="modal-close"
              type="button"
              onClick={() => setBookingDetailsOpen(false)}
              aria-label="Close booking details"
            >
              ×
            </button>
            <p className="eyebrow">BOOKING DETAILS</p>
            <h2 id="booking-details-title">Your appointment</h2>
            <dl className="booking-details-list">
              <div><dt>Confirmation number</dt><dd>{lookupBooking.id}</dd></div>
              <div><dt>Name</dt><dd>{lookupBooking.name}</dd></div>
              <div><dt>Email</dt><dd>{lookupBooking.email}</dd></div>
              <div><dt>Doctor</dt><dd>{slotById[lookupBooking.slot_id]?.provider ?? "Unavailable"}</dd></div>
              <div><dt>Appointment time</dt><dd>{slotById[lookupBooking.slot_id] ? formatDateTime(slotById[lookupBooking.slot_id].start) : "Unavailable"}</dd></div>
              <div><dt>Status</dt><dd className={`booking-status ${lookupBooking.status}`}>{lookupBooking.status}</dd></div>
              <div><dt>Booked</dt><dd>{formatDateTime(lookupBooking.created_at)}</dd></div>
            </dl>
          </section>
        </div>
      )}

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
                        setBookingError("");
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
                  <input id="name" autoComplete="name" value={name} onChange={(event) => { setName(event.target.value); setBookingError(""); }} required maxLength={120} />
                  <label htmlFor="email">Email address</label>
                  <input id="email" type="email" autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); setBookingError(""); }} required maxLength={254} />
                  <button className="button button-dark button-wide" type="submit" disabled={submitting}>
                    {submitting ? "Confirming…" : "Confirm appointment"}
                  </button>
                  {bookingError && (
                    <InlineFeedback message={{ type: "error", text: bookingError }} />
                  )}
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
  onDetails,
  message,
  compact = false,
}: {
  booking: Booking;
  slot?: Slot;
  onCancel: (booking: Booking, location: BookingMessageLocation) => void;
  onDetails?: () => void;
  message?: InlineMessage;
  compact?: boolean;
}) {
  return (
    <div>
      <div className={`booking-summary ${compact ? "booking-summary-compact" : ""}`}>
        <div>
          <span className={`booking-status ${booking.status}`}>{booking.status}</span>
          <strong>{booking.name}</strong>
          <span>{slot ? formatDateTime(slot.start) : `Booked ${formatDateTime(booking.created_at)}`}</span>
          {slot && <span>Doctor: {slot.provider}</span>}
          <span className="booking-reference">Ref {booking.id}</span>
        </div>
        <div className="booking-actions">
          {booking.status === "confirmed" && (
            <button
              type="button"
              className="cancel-link"
              onClick={() => onCancel(booking, compact ? "appointments" : "lookup")}
            >
              Cancel
            </button>
          )}
          {onDetails && (
            <button
              type="button"
              className="booking-details-link"
              onClick={onDetails}
            >
              Details
            </button>
          )}
        </div>
      </div>
      {message && <InlineFeedback message={message} />}
    </div>
  );
}

function InlineFeedback({ message }: { message: InlineMessage }) {
  const isError = message.type === "error";
  return (
    <div
      className={`feedback feedback-${message.type} inline-feedback`}
      role={isError ? "alert" : "status"}
    >
      <span>{message.text}</span>
    </div>
  );
}
