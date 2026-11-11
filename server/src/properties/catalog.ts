/**
 * Property catalog — categories, property types, field definitions and amenities.
 *
 * This is the single source of truth that is synced into MySQL (property_types, amenities) at startup
 * and served to every client (Android, iOS, Admin Panel) from GET /api/v1/property-types, so all of
 * them render the same dynamic forms and the API validates against the same definitions.
 *
 * To add a new type: add an entry to PROPERTY_TYPES using one of the existing structures. No database
 * change is needed — type-specific values live in the `attributes` JSON column, validated here.
 */

export const CATEGORIES = ["RESIDENTIAL", "COMMERCIAL", "LAND"] as const;
export type Category = (typeof CATEGORIES)[number];

export const LISTING_TYPES = ["RENT", "LEASE", "SALE"] as const;
export type ListingTypeKey = (typeof LISTING_TYPES)[number];

export const DISCLOSURE = ["YES", "NO", "NOT_APPLICABLE", "NOT_DISCLOSED"] as const;
export type DisclosureValue = (typeof DISCLOSURE)[number];

export const AVAILABILITY = ["AVAILABLE", "OCCUPIED", "RESERVED", "UNDER_MAINTENANCE", "NOT_AVAILABLE"] as const;
export type AvailabilityValue = (typeof AVAILABILITY)[number];

export const ACTIVE_STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED", "ARCHIVED"] as const;
export type ActiveStatusValue = (typeof ACTIVE_STATUSES)[number];

export const PUBLICATION_STATUSES = ["DRAFT", "PENDING_VERIFICATION", "APPROVED", "REJECTED", "PUBLISHED"] as const;
export type PublicationStatusValue = (typeof PUBLICATION_STATUSES)[number];

export const VERIFICATION_STATUSES = ["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"] as const;

export const FURNISHING = ["UNFURNISHED", "SEMI_FURNISHED", "FULLY_FURNISHED", "NOT_DISCLOSED"] as const;

export const IMAGE_CATEGORIES = [
  "FRONT_VIEW",
  "ENTRANCE",
  "LIVING_ROOM",
  "BEDROOM",
  "KITCHEN",
  "BATHROOM",
  "BALCONY",
  "PARKING",
  "BUILDING_EXTERIOR",
  "COMMON_AREA",
  "METER_READING",
  "INSPECTION",
  "OTHER",
] as const;

export const DOCUMENT_TYPES = [
  "OWNERSHIP_PROOF",
  "SALE_DEED",
  "PROPERTY_TAX_RECEIPT",
  "ELECTRICITY_BILL",
  "BUILDING_PERMISSION",
  "RENTAL_AGREEMENT",
  "LANDLORD_IDENTITY",
  "OTHER",
] as const;

/** Documents that prove ownership (used by the verification workflow and the completeness score). */
export const OWNERSHIP_DOCUMENTS = ["OWNERSHIP_PROOF", "SALE_DEED", "PROPERTY_TAX_RECEIPT"] as const;

export const VILLA_CONFIGURATIONS = ["B+G", "B+G+1", "G", "G+1", "G+2", "G+3", "G+4", "CUSTOM"] as const;
export const DUPLEX_CONFIGURATIONS = ["G+1", "G+2", "CUSTOM"] as const;
export const BHK_TYPES = ["1RK", "1BHK", "1.5BHK", "2BHK", "2.5BHK", "3BHK", "4BHK", "5BHK+"] as const;
export const PG_TYPES = ["BOYS", "GIRLS", "CO_LIVING"] as const;
export const SHARING_TYPES = ["SINGLE", "DOUBLE", "TRIPLE", "FOUR_SHARING", "CUSTOM"] as const;
export const AREA_UNITS = ["SQFT", "SQYD", "SQM", "ACRE", "HECTARE"] as const;
export const FACING = ["NORTH", "SOUTH", "EAST", "WEST", "NORTH_EAST", "NORTH_WEST", "SOUTH_EAST", "SOUTH_WEST", "NOT_DISCLOSED"] as const;

/**
 * How a type is organised:
 *  MULTI_UNIT  — one building, many units (apartment flats, office spaces). Building details entered once.
 *  VILLA       — a standalone villa (exactly one unit) or a villa community/project (many villas).
 *  SINGLE_UNIT — one independent record (house, duplex, farmhouse, plot) with exactly one unit.
 *  ROOMS_BEDS  — PG / hostel: building → rooms → beds.
 */
export const STRUCTURES = ["MULTI_UNIT", "VILLA", "SINGLE_UNIT", "ROOMS_BEDS"] as const;
export type Structure = (typeof STRUCTURES)[number];

export const UNIT_KINDS = ["FLAT", "VILLA", "HOUSE", "DUPLEX", "FARMHOUSE", "COMMERCIAL_SPACE", "PLOT"] as const;
export type UnitKindValue = (typeof UNIT_KINDS)[number];

export type FieldType = "text" | "textarea" | "integer" | "decimal" | "money" | "boolean" | "disclosure" | "select" | "date";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** Required before the property can be submitted for verification (drafts can be incomplete). */
  required?: boolean;
  options?: readonly string[];
  min?: number;
  max?: number;
  maxLength?: number;
  help?: string;
  /** Required only when another field has a given value, e.g. customConfiguration when configuration = CUSTOM. */
  requiredWhen?: { field: string; equals: string };
}

export interface PropertyTypeDef {
  key: string;
  category: Category;
  label: string;
  structure: Structure;
  /** Kind of unit created inside this property (not used for ROOMS_BEDS). */
  unitKind?: UnitKindValue;
  /** Singular label of a unit in the UI ("Flat", "Villa", "Office space" …). */
  unitLabel?: string;
  listingTypes: readonly ListingTypeKey[];
  /** Building / property level fields. Keys in PROPERTY_COLUMNS are stored as columns, others in `attributes`. */
  buildingFields: readonly FieldDef[];
  /** Unit level fields. Keys in UNIT_COLUMNS are stored as columns, others in `attributes`. */
  unitFields: readonly FieldDef[];
  /** Duplex: unit has floor-wise details. */
  floorWise?: boolean;
}

/** Building-level field keys stored as real columns on `properties`. */
export const PROPERTY_COLUMNS = ["name", "totalFloors", "totalUnits"] as const;

/** Unit-level field keys stored as real columns on `property_units`. */
export const UNIT_COLUMNS = [
  "name",
  "unitNumber",
  "floorNumber",
  "bhkType",
  "bedrooms",
  "bathrooms",
  "balconies",
  "kitchenCount",
  "livingRoomCount",
  "builtUpArea",
  "carpetArea",
  "plotArea",
  "furnishing",
  "configuration",
  "totalFloors",
  "parkingCapacity",
  "parkingDetails",
  "availableFrom",
  "availabilityStatus",
] as const;

// ───── Reusable field definitions ─────
const f = {
  int: (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: "integer", min: 0, max: 10000, ...extra }),
  area: (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: "decimal", min: 0, max: 100_000_000, help: "In the selected area unit (default sq.ft).", ...extra }),
  text: (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: "text", maxLength: 255, ...extra }),
  yesNo: (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: "disclosure", options: DISCLOSURE, ...extra }),
  select: (key: string, label: string, options: readonly string[], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: "select", options, ...extra }),
};

const furnishing = f.select("furnishing", "Furnishing", FURNISHING, { required: true });
const availability: FieldDef[] = [
  { key: "availableFrom", label: "Available from", type: "date" },
  f.select("availabilityStatus", "Availability", AVAILABILITY, { required: true }),
];
const customConfiguration = f.text("customConfiguration", "Custom configuration", { maxLength: 40, requiredWhen: { field: "configuration", equals: "CUSTOM" }, help: "e.g. B+G+2+Penthouse" });

const commercialBuilding: FieldDef[] = [
  f.text("name", "Building name", { required: true, maxLength: 150 }),
  f.int("totalFloors", "Total floors", { required: true, max: 200 }),
  f.int("totalUnits", "Total units / spaces", { max: 10000 }),
  f.yesNo("liftAvailable", "Lift available"),
  f.yesNo("securityAvailable", "Security available"),
  f.yesNo("parkingAvailable", "Parking available"),
];

const commercialUnit = (extra: FieldDef[] = []): FieldDef[] => [
  f.text("unitNumber", "Unit / space number", { required: true, maxLength: 30 }),
  { ...f.int("floorNumber", "Floor number", { min: -5, max: 200 }) },
  f.area("builtUpArea", "Built-up area", { required: true }),
  f.area("carpetArea", "Carpet area"),
  furnishing,
  f.int("washrooms", "Washrooms", { max: 100 }),
  f.yesNo("pantryAvailable", "Pantry"),
  f.int("parkingCapacity", "Parking capacity", { max: 1000 }),
  f.text("parkingDetails", "Parking details"),
  ...extra,
  ...availability,
];

const landUnit: FieldDef[] = [
  f.text("unitNumber", "Plot / survey number", { required: true, maxLength: 30 }),
  f.area("plotArea", "Plot area", { required: true }),
  f.select("areaUnit", "Area unit", AREA_UNITS, { required: true }),
  f.select("facing", "Facing", FACING),
  { key: "roadWidthFt", label: "Road width (ft)", type: "decimal", min: 0, max: 1000 },
  f.yesNo("boundaryWall", "Boundary wall"),
  f.yesNo("cornerPlot", "Corner plot"),
  f.text("approvalAuthority", "Approval authority", { help: "e.g. HMDA, DTCP, GHMC. Leave empty if not disclosed." }),
  ...availability,
];

const landBuilding: FieldDef[] = [f.text("name", "Plot / land name", { maxLength: 150 })];

/** Every supported property type. Order = display order. */
export const PROPERTY_TYPES: readonly PropertyTypeDef[] = [
  {
    key: "APARTMENT",
    category: "RESIDENTIAL",
    label: "Apartment",
    structure: "MULTI_UNIT",
    unitKind: "FLAT",
    unitLabel: "Flat",
    listingTypes: ["RENT", "LEASE", "SALE"],
    buildingFields: [
      f.text("name", "Apartment name", { required: true, maxLength: 150 }),
      f.text("buildingName", "Building / block name", { maxLength: 120 }),
      f.int("totalFloors", "Total floors", { required: true, max: 200 }),
      f.int("totalUnits", "Total flats", { required: true, max: 10000 }),
      f.yesNo("securityAvailable", "Security available"),
      f.yesNo("liftAvailable", "Lift available"),
      f.yesNo("parkingAvailable", "Parking available"),
    ],
    unitFields: [
      f.text("unitNumber", "Flat number", { required: true, maxLength: 30 }),
      f.int("floorNumber", "Floor number", { required: true, min: -5, max: 200 }),
      f.select("bhkType", "BHK type", BHK_TYPES, { required: true }),
      f.int("bedrooms", "Bedrooms", { required: true, max: 20 }),
      f.int("bathrooms", "Bathrooms", { required: true, max: 20 }),
      f.int("balconies", "Balconies", { max: 20 }),
      f.int("kitchenCount", "Kitchens", { max: 10 }),
      f.int("livingRoomCount", "Living rooms", { max: 10 }),
      f.area("builtUpArea", "Built-up area (sq.ft)"),
      f.area("carpetArea", "Carpet area (sq.ft)"),
      furnishing,
      f.text("parkingDetails", "Parking details", { help: "e.g. 1 covered car parking" }),
      ...availability,
    ],
  },
  {
    key: "VILLA",
    category: "RESIDENTIAL",
    label: "Villa",
    structure: "VILLA",
    unitKind: "VILLA",
    unitLabel: "Villa",
    listingTypes: ["RENT", "LEASE", "SALE"],
    buildingFields: [
      f.select("villaListing", "Villa listing", ["STANDALONE", "COMMUNITY"], { required: true, help: "A single villa, or a villa community / project with many villas." }),
      f.text("name", "Villa / project name", { required: true, maxLength: 150 }),
      f.int("totalUnits", "Total villas", { max: 5000 }),
      f.int("totalFloors", "Floors (project)", { max: 20 }),
      f.text("securityDetails", "Security details"),
      f.text("parkingFacilities", "Parking facilities"),
    ],
    unitFields: [
      f.text("name", "Villa name", { maxLength: 120 }),
      f.text("unitNumber", "Villa number", { required: true, maxLength: 30 }),
      f.select("configuration", "Configuration", VILLA_CONFIGURATIONS, { required: true }),
      customConfiguration,
      f.yesNo("basementAvailable", "Basement"),
      f.int("totalFloors", "Total floors", { max: 20 }),
      f.int("bedrooms", "Bedrooms", { required: true, max: 30 }),
      f.int("bathrooms", "Bathrooms", { required: true, max: 30 }),
      f.int("kitchenCount", "Kitchens", { max: 10 }),
      f.int("livingRoomCount", "Living rooms", { max: 10 }),
      f.int("balconies", "Balconies", { max: 20 }),
      f.area("plotArea", "Plot area (sq.ft)"),
      f.area("builtUpArea", "Built-up area (sq.ft)"),
      furnishing,
      f.int("parkingCapacity", "Parking capacity (cars)", { max: 50 }),
      f.yesNo("gardenAvailable", "Garden"),
      f.yesNo("terraceAvailable", "Terrace"),
      ...availability,
    ],
  },
  {
    key: "INDIVIDUAL_HOUSE",
    category: "RESIDENTIAL",
    label: "Individual house",
    structure: "SINGLE_UNIT",
    unitKind: "HOUSE",
    unitLabel: "House",
    listingTypes: ["RENT", "LEASE", "SALE"],
    buildingFields: [f.text("name", "House name", { maxLength: 150 })],
    unitFields: [
      f.text("unitNumber", "House number", { required: true, maxLength: 30 }),
      f.select("configuration", "Configuration", VILLA_CONFIGURATIONS),
      customConfiguration,
      f.int("totalFloors", "Total floors", { max: 20 }),
      f.int("bedrooms", "Bedrooms", { required: true, max: 30 }),
      f.int("bathrooms", "Bathrooms", { required: true, max: 30 }),
      f.int("kitchenCount", "Kitchens", { max: 10 }),
      f.int("balconies", "Balconies", { max: 20 }),
      f.area("plotArea", "Plot area (sq.ft)"),
      f.area("builtUpArea", "Built-up area (sq.ft)"),
      furnishing,
      f.int("parkingCapacity", "Parking capacity (cars)", { max: 50 }),
      f.text("waterFacilities", "Water facilities", { help: "e.g. Municipal + borewell, overhead tank" }),
      f.text("electricityDetails", "Electricity details", { help: "e.g. Separate meter, 3-phase" }),
      ...availability,
    ],
  },
  {
    key: "DUPLEX_HOUSE",
    category: "RESIDENTIAL",
    label: "Duplex house",
    structure: "SINGLE_UNIT",
    unitKind: "DUPLEX",
    unitLabel: "Duplex",
    floorWise: true,
    listingTypes: ["RENT", "LEASE", "SALE"],
    buildingFields: [f.text("name", "Duplex name", { maxLength: 150 })],
    unitFields: [
      f.text("unitNumber", "House number", { required: true, maxLength: 30 }),
      f.select("configuration", "Configuration", DUPLEX_CONFIGURATIONS, { required: true }),
      customConfiguration,
      f.int("totalFloors", "Total floors", { required: true, min: 2, max: 10 }),
      f.area("plotArea", "Plot area (sq.ft)"),
      f.area("builtUpArea", "Built-up area (sq.ft)"),
      furnishing,
      f.int("parkingCapacity", "Parking capacity (cars)", { max: 50 }),
      ...availability,
    ],
  },
  {
    key: "PG",
    category: "RESIDENTIAL",
    label: "PG",
    structure: "ROOMS_BEDS",
    listingTypes: ["RENT"],
    buildingFields: pgBuildingFields("PG name"),
    unitFields: [],
  },
  {
    key: "HOSTEL",
    category: "RESIDENTIAL",
    label: "Hostel",
    structure: "ROOMS_BEDS",
    listingTypes: ["RENT"],
    buildingFields: pgBuildingFields("Hostel name"),
    unitFields: [],
  },
  {
    key: "FARMHOUSE",
    category: "RESIDENTIAL",
    label: "Farmhouse",
    structure: "SINGLE_UNIT",
    unitKind: "FARMHOUSE",
    unitLabel: "Farmhouse",
    listingTypes: ["RENT", "LEASE", "SALE"],
    buildingFields: [f.text("name", "Farmhouse name", { maxLength: 150 })],
    unitFields: [
      f.text("unitNumber", "Survey / house number", { required: true, maxLength: 30 }),
      f.int("bedrooms", "Bedrooms", { required: true, max: 30 }),
      f.int("bathrooms", "Bathrooms", { required: true, max: 30 }),
      f.area("plotArea", "Land area", { required: true }),
      f.select("areaUnit", "Area unit", AREA_UNITS, { required: true }),
      f.area("builtUpArea", "Built-up area (sq.ft)"),
      furnishing,
      f.int("parkingCapacity", "Parking capacity (cars)", { max: 100 }),
      f.text("waterSource", "Water source"),
      ...availability,
    ],
  },
  { key: "OFFICE_SPACE", category: "COMMERCIAL", label: "Office space", structure: "MULTI_UNIT", unitKind: "COMMERCIAL_SPACE", unitLabel: "Office space", listingTypes: ["RENT", "LEASE", "SALE"], buildingFields: commercialBuilding, unitFields: commercialUnit([f.int("workstations", "Workstations", { max: 10000 }), f.int("cabins", "Cabins", { max: 1000 }), f.int("meetingRooms", "Meeting rooms", { max: 500 })]) },
  { key: "SHOP", category: "COMMERCIAL", label: "Shop", structure: "MULTI_UNIT", unitKind: "COMMERCIAL_SPACE", unitLabel: "Shop", listingTypes: ["RENT", "LEASE", "SALE"], buildingFields: commercialBuilding, unitFields: commercialUnit([{ key: "frontageFt", label: "Frontage (ft)", type: "decimal", min: 0, max: 1000 }, f.yesNo("mainRoadFacing", "Main road facing")]) },
  { key: "SHOWROOM", category: "COMMERCIAL", label: "Showroom", structure: "MULTI_UNIT", unitKind: "COMMERCIAL_SPACE", unitLabel: "Showroom", listingTypes: ["RENT", "LEASE", "SALE"], buildingFields: commercialBuilding, unitFields: commercialUnit([{ key: "frontageFt", label: "Frontage (ft)", type: "decimal", min: 0, max: 1000 }, f.yesNo("mainRoadFacing", "Main road facing")]) },
  { key: "WAREHOUSE", category: "COMMERCIAL", label: "Warehouse", structure: "MULTI_UNIT", unitKind: "COMMERCIAL_SPACE", unitLabel: "Warehouse unit", listingTypes: ["RENT", "LEASE", "SALE"], buildingFields: commercialBuilding, unitFields: commercialUnit([{ key: "clearHeightFt", label: "Clear height (ft)", type: "decimal", min: 0, max: 200 }, f.int("loadingDocks", "Loading docks", { max: 200 }), f.yesNo("truckAccess", "Truck access")]) },
  { key: "INDUSTRIAL_PROPERTY", category: "COMMERCIAL", label: "Industrial property", structure: "MULTI_UNIT", unitKind: "COMMERCIAL_SPACE", unitLabel: "Industrial unit", listingTypes: ["RENT", "LEASE", "SALE"], buildingFields: commercialBuilding, unitFields: commercialUnit([{ key: "powerLoadKw", label: "Sanctioned power load (kW)", type: "decimal", min: 0, max: 100000 }, f.yesNo("truckAccess", "Truck access")]) },
  { key: "COWORKING_SPACE", category: "COMMERCIAL", label: "Coworking space", structure: "MULTI_UNIT", unitKind: "COMMERCIAL_SPACE", unitLabel: "Desk / cabin", listingTypes: ["RENT"], buildingFields: commercialBuilding, unitFields: commercialUnit([f.int("seats", "Seats", { required: true, min: 1, max: 10000 })]) },
  { key: "RESIDENTIAL_PLOT", category: "LAND", label: "Residential plot", structure: "SINGLE_UNIT", unitKind: "PLOT", unitLabel: "Plot", listingTypes: ["LEASE", "SALE"], buildingFields: landBuilding, unitFields: landUnit },
  { key: "COMMERCIAL_PLOT", category: "LAND", label: "Commercial plot", structure: "SINGLE_UNIT", unitKind: "PLOT", unitLabel: "Plot", listingTypes: ["RENT", "LEASE", "SALE"], buildingFields: landBuilding, unitFields: landUnit },
  { key: "AGRICULTURAL_LAND", category: "LAND", label: "Agricultural land", structure: "SINGLE_UNIT", unitKind: "PLOT", unitLabel: "Land parcel", listingTypes: ["RENT", "LEASE", "SALE"], buildingFields: landBuilding, unitFields: [...landUnit.slice(0, -2), f.text("waterSource", "Water source"), ...availability] },
  { key: "INDUSTRIAL_LAND", category: "LAND", label: "Industrial land", structure: "SINGLE_UNIT", unitKind: "PLOT", unitLabel: "Land parcel", listingTypes: ["RENT", "LEASE", "SALE"], buildingFields: landBuilding, unitFields: landUnit },
];

function pgBuildingFields(nameLabel: string): FieldDef[] {
  return [
    f.text("name", nameLabel, { required: true, maxLength: 150 }),
    f.select("pgType", "Type", PG_TYPES, { required: true }),
    f.int("totalFloors", "Total floors", { required: true, max: 100 }),
    f.int("totalUnits", "Total rooms", { required: true, max: 5000 }),
    f.int("totalBedCapacity", "Total bed capacity", { max: 20000, help: "Available beds are always calculated from the actual bed records." }),
    f.yesNo("foodAvailable", "Food available"),
    f.yesNo("wifiAvailable", "Wi-Fi"),
    f.yesNo("washingMachineAvailable", "Washing machine"),
    f.yesNo("securityAvailable", "Security"),
    f.yesNo("cctvAvailable", "CCTV"),
    f.yesNo("parkingAvailable", "Parking"),
  ];
}

const TYPE_MAP = new Map(PROPERTY_TYPES.map((t) => [t.key, t]));

export function propertyTypeDef(key: string): PropertyTypeDef | undefined {
  return TYPE_MAP.get(key);
}

/** Maximum number of units allowed for a property (null = unlimited). */
export function maxUnits(type: PropertyTypeDef, attributes: Record<string, unknown> | null | undefined): number | null {
  if (type.structure === "SINGLE_UNIT") return 1;
  if (type.structure === "ROOMS_BEDS") return 0;
  if (type.structure === "VILLA") return attributes?.villaListing === "COMMUNITY" ? null : 1;
  return null;
}

// ───── Amenities ─────
export interface AmenityDef {
  key: string;
  label: string;
  categories: readonly Category[];
}

const ALL: readonly Category[] = ["RESIDENTIAL", "COMMERCIAL", "LAND"];
const BUILT: readonly Category[] = ["RESIDENTIAL", "COMMERCIAL"];
const RES: readonly Category[] = ["RESIDENTIAL"];

export const AMENITIES: readonly AmenityDef[] = [
  { key: "LIFT", label: "Lift", categories: BUILT },
  { key: "COVERED_PARKING", label: "Covered parking", categories: BUILT },
  { key: "OPEN_PARKING", label: "Open parking", categories: ALL },
  { key: "SECURITY", label: "Security", categories: ALL },
  { key: "CCTV", label: "CCTV", categories: ALL },
  { key: "GYM", label: "Gym", categories: RES },
  { key: "SWIMMING_POOL", label: "Swimming pool", categories: RES },
  { key: "GARDEN", label: "Garden", categories: RES },
  { key: "CHILDRENS_PLAY_AREA", label: "Children's play area", categories: RES },
  { key: "CLUBHOUSE", label: "Clubhouse", categories: RES },
  { key: "POWER_BACKUP", label: "Power backup", categories: BUILT },
  { key: "WATER_SUPPLY", label: "Water supply", categories: ALL },
  { key: "HOUSEKEEPING", label: "Housekeeping", categories: BUILT },
  { key: "WASTE_COLLECTION", label: "Waste collection", categories: BUILT },
  { key: "INTERNET", label: "Internet", categories: BUILT },
  { key: "WASHING_MACHINE", label: "Washing machine", categories: RES },
  { key: "FURNISHED_KITCHEN", label: "Furnished kitchen", categories: RES },
  { key: "AIR_CONDITIONING", label: "Air conditioning", categories: BUILT },
  { key: "FIRE_SAFETY", label: "Fire safety", categories: BUILT },
  { key: "CAFETERIA", label: "Cafeteria", categories: ["COMMERCIAL"] },
  { key: "CONFERENCE_ROOM", label: "Conference room", categories: ["COMMERCIAL"] },
  { key: "LOADING_BAY", label: "Loading bay", categories: ["COMMERCIAL"] },
  { key: "FENCING", label: "Fencing", categories: ["LAND"] },
  { key: "ROAD_ACCESS", label: "Road access", categories: ["LAND"] },
];

/** Default completeness weights (%). Overridable in platform_settings.completeness_weights. */
export const DEFAULT_COMPLETENESS_WEIGHTS = {
  basic: 15,
  locationImages: 15,
  units: 15,
  utilities: 15,
  policies: 10,
  amenities: 10,
  financial: 15,
  documents: 5,
} as const;
export type CompletenessWeights = Record<keyof typeof DEFAULT_COMPLETENESS_WEIGHTS, number>;

/** Readable ID prefixes. */
export const ID_PREFIX = {
  PROPERTY: "SR-PROP",
  APARTMENT_UNIT: "SR-UNIT",
  VILLA: "SR-VILLA",
  ROOM: "SR-ROOM",
  BED: "SR-BED",
  DOCUMENT: "SR-DOC",
  LEASE: "SR-LEASE",
  INVITATION: "SR-INV",
  REVIEW: "SR-REV",
  REFERRAL: "SR-REF",
  TOPUP: "SR-TOP",
  DOC_REQUEST: "SR-DREQ",
} as const;
export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX];

export function unitPrefix(kind: UnitKindValue): IdPrefix {
  return kind === "VILLA" ? ID_PREFIX.VILLA : ID_PREFIX.APARTMENT_UNIT;
}
