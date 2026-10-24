import { expect, it } from "vitest"
import { z } from "zod"
import { NotFoundError, ForbiddenError } from "../errors"
import { StudioCommandError } from "./errors"
import { studioDelegatedError } from "./delegated-errors"
it("distinguishes recoverable missing snapshots, conflicts, invalid input, and permission failures", () => {
  expect(
    studioDelegatedError(new NotFoundError("ShortSourceSnapshot")),
  ).toMatchObject({
    status: 404,
    error: expect.stringContaining("shorts.capture"),
  })
  expect(studioDelegatedError(new StudioCommandError("CONFLICT"))).toEqual({
    status: 409,
    error: "CONFLICT",
  })
  expect(studioDelegatedError(new ForbiddenError("private details"))).toEqual({
    status: 403,
    error: "Studio access denied",
  })
  const result = z.string().safeParse({ private: "secret" })
  if (!result.success)
    expect(studioDelegatedError(result.error)).toEqual({
      status: 400,
      error: "Invalid Studio command input",
    })
  expect(studioDelegatedError(new Error("secret database details"))).toEqual({
    status: 500,
    error: "Studio command rejected",
  })
})
