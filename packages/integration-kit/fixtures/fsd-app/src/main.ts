import { addToCart } from "@/features/cart";
import { badShared } from "@/shared/lib/bad";
import { header } from "@/widgets/header";
export const app = [header, badShared, addToCart];
