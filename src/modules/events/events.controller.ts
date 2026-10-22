import type { Request, Response } from "express";
import * as service from "./events.service.js";

const id = (req: Request) => String(req.params.id);

export async function list(req: Request, res: Response) {
  const { maxResults, timeMin, timeMax, q } = req.query;
  const events = await service.list(req.googleAuth!, {
    maxResults: maxResults ? Number(maxResults) : undefined,
    timeMin: timeMin?.toString(),
    timeMax: timeMax?.toString(),
    q: q?.toString(),
  });
  res.json(events);
}

export async function get(req: Request, res: Response) {
  res.json(await service.get(req.googleAuth!, id(req)));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await service.create(req.googleAuth!, req.body));
}

export async function update(req: Request, res: Response) {
  res.json(await service.update(req.googleAuth!, id(req), req.body));
}

export async function remove(req: Request, res: Response) {
  await service.remove(req.googleAuth!, id(req));
  res.status(204).end();
}
