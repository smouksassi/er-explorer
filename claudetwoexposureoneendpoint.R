library(ggplot2)
library(ggquickeda)

effICGI <- logistic_data |>
  dplyr::filter(!is.na(ICGI))|>
  dplyr::filter(!is.na(AUC))
effICGI$DOSE <- factor(effICGI$DOSE,
                       levels=c("0", "600", "1200","1800","2400"),
                       labels=c("Placebo", "600 mg", "1200 mg","1800 mg","2400 mg"))
effICGI$STUDY <- factor(effICGI$STUDY)
effICGI$ICGI2 <- effICGI$ICGI
effICGI <- tidyr::gather(effICGI,Endpoint,response,ICGI,ICGI2)

effICGI <- logistic_data |>
  dplyr::filter(!is.na(ICGI))|>
  dplyr::filter(!is.na(AUC))
effICGI$DOSE <- factor(effICGI$DOSE,
                       levels=c("0", "600", "1200","1800","2400"),
                       labels=c("Placebo", "600 mg", "1200 mg","1800 mg","2400 mg"))
effICGI$STUDY <- factor(effICGI$STUDY)
effICGI$ICGI2 <- ifelse(effICGI$ICGI7 < 4,1,0)
effICGI$ICGI3 <- ifelse(effICGI$ICGI7 < 5,1,0)
#rite.csv(effICGI,"effICGIwide.csv",row.names = FALSE)
effICGI <- tidyr::gather(effICGI,Endpoint,response,ICGI,ICGI2,ICGI3)
# effICGI <- tidyr::gather(effICGI,exposuremetric,exposurevalue,AUC,CMAX)
# write.csv(effICGI,"effICGIlong.csv",row.names = FALSE)
effICGI$endpointcol2 <- effICGI$Endpoint
effICGI$endpointcol3 <- effICGI$Endpoint




ggresponseexpdist(data = effICGI |> 
                    dplyr::filter(Endpoint=="ICGI"),
                  points_show = TRUE,
                  exposure_metrics = c("AUC","CMAX"),
                  exposure_distribution_percent =  "N (%)",
                  exposure_distribution_Ntotal = "right",
                  exposure_distribution ="distributions",
                  exposure_metric_split =  "tertile",
                  model_type = "logistic")+
  facet_grid(Endpoint~expname,scales="free_x")