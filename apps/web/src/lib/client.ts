import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"
import { env } from "@/env"

const uri = env.NEXT_PUBLIC_GRAPHQL_URL ?? "http://localhost:1337/graphql"
const client = new ApolloClient({
  link: new HttpLink({ uri }),
  cache: new InMemoryCache(),
})

export default client
