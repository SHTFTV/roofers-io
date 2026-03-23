import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, bookingsTable } from "@workspace/db";
import {
  CreateBookingBody,
  DeleteBookingParams,
  ListBookingsQueryParams,
  ListBookingsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/bookings", async (req, res): Promise<void> => {
  const query = ListBookingsQueryParams.safeParse(req.query);
  const month = query.success && query.data.month != null ? query.data.month : null;
  const year = query.success && query.data.year != null ? query.data.year : null;

  let bookings = await db.select().from(bookingsTable).orderBy(bookingsTable.date);

  if (month != null && year != null) {
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    bookings = bookings.filter((b) => b.date.startsWith(prefix));
  }

  res.json(ListBookingsResponse.parse(bookings));
});

router.post("/bookings", async (req, res): Promise<void> => {
  const parsed = CreateBookingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [booking] = await db
    .insert(bookingsTable)
    .values({
      jobId: parsed.data.jobId ?? null,
      client: parsed.data.client,
      addr: parsed.data.addr ?? "",
      date: parsed.data.date,
      time: parsed.data.time,
      type: parsed.data.type ?? "Full Re-Roof",
      notes: parsed.data.notes ?? "",
    })
    .returning();

  res.status(201).json(booking);
});

router.delete("/bookings/:id", async (req, res): Promise<void> => {
  const params = DeleteBookingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [booking] = await db
    .delete(bookingsTable)
    .where(eq(bookingsTable.id, params.data.id))
    .returning();

  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
