export interface NamedRef<TId extends string | number = string> {
  id: TId;
  name: string;
}

/** A customer's saved address (GET /me/addresses). */
export interface Address {
  id: string;
  label: string | null;
  province: NamedRef<number>;
  district: NamedRef;
  neighborhood: string | null;
  addressLine: string;
  buildingNo: string | null;
  apartmentNo: string | null;
  postalCode: string | null;
  instructions: string | null;
  /** WGS84; both null or both set. */
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}
